import { buildGeminiGenerateContentRequest } from "../gemini-chat-codec";
import {
	mergeParsedToolCalls,
	parseToolCallsFromText,
	shouldCaptureToolCallText,
} from "../tool-call-parser";
import type { AnthropicRequest, ChatTransportEvent } from "../types";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiChatAdapter {
	async *stream(
		request: AnthropicRequest,
		options: { signal: AbortSignal; apiKey?: string },
	): AsyncGenerator<ChatTransportEvent> {
		if (options.signal.aborted) {
			throw new DOMException("Aborted", "AbortError");
		}
		const apiKey = options.apiKey?.trim();
		if (!apiKey) {
			throw new Error(
				"Google Gemini API key is missing. Add it in Settings to use Gemini models.",
			);
		}

		const payload = buildGeminiGenerateContentRequest(request);
		const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(
			request.model,
		)}:streamGenerateContent?alt=sse`;
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": apiKey,
			},
			body: JSON.stringify(payload),
			signal: options.signal,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(
				toUserFacingGeminiErrorMessage(
					response.status,
					errorText,
					request.model,
				),
			);
		}

		yield { type: "message_start" };

		const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
		const isSse = contentType.includes("text/event-stream") && response.body;
		const textFragments: string[] = [];
		const parserCandidateFragments: string[] = [];
		let bufferedToolCallText = "";

		const handleTextFragment = function* (
			fragment: string,
		): Generator<ChatTransportEvent> {
			if (!fragment) {
				return;
			}
			if (shouldCaptureToolCallText(fragment, bufferedToolCallText)) {
				bufferedToolCallText += fragment;
				parserCandidateFragments.push(fragment);
				return;
			}
			textFragments.push(fragment);
			yield { type: "content_delta", text: fragment };
		};

		if (isSse) {
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

				while (true) {
					const boundary = buffer.indexOf("\n\n");
					if (boundary === -1) {
						break;
					}

					const eventBlock = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const data = eventBlock
						.split("\n")
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trimStart())
						.join("\n")
						.trim();

					if (!data || data === "[DONE]") {
						continue;
					}

					const parsed = JSON.parse(data) as GeminiStreamEnvelope;
					for (const fragment of extractGeminiTextFragments(parsed)) {
						for (const event of handleTextFragment(fragment)) {
							yield event;
						}
					}
				}
			}
		} else {
			const parsed = (await response.json()) as GeminiStreamEnvelope;
			for (const fragment of extractGeminiTextFragments(parsed)) {
				for (const event of handleTextFragment(fragment)) {
					yield event;
				}
			}
		}

		const parsedToolCalls = parseToolCallsFromText(
			parserCandidateFragments.length
				? parserCandidateFragments.join("")
				: textFragments.join(""),
		);
		const mergedToolCalls = mergeParsedToolCalls([], parsedToolCalls);
		if (mergedToolCalls.length > 0) {
			yield {
				type: "tool_calls",
				calls: mergedToolCalls,
			};
		} else if (parserCandidateFragments.length > 0) {
			yield {
				type: "content_delta",
				text: parserCandidateFragments.join(""),
			};
		}

		yield { type: "message_stop" };
	}
}

type GeminiStreamEnvelope = {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
			}>;
		};
	}>;
};

function extractGeminiTextFragments(payload: GeminiStreamEnvelope): string[] {
	const fragments: string[] = [];
	for (const candidate of payload.candidates ?? []) {
		for (const part of candidate.content?.parts ?? []) {
			if (typeof part.text === "string" && part.text.length > 0) {
				fragments.push(part.text);
			}
		}
	}
	return fragments;
}

type GeminiApiErrorPayload = {
	error?: {
		code?: number;
		message?: string;
		status?: string;
		details?: Array<{
			"@type"?: string;
			retryDelay?: string;
		}>;
	};
};

function toUserFacingGeminiErrorMessage(
	status: number,
	errorText: string,
	model: string,
): string {
	const parsed = parseGeminiApiError(errorText);
	const apiMessage = parsed?.error?.message?.trim();
	const retryDelay = getRetryDelaySeconds(parsed);

	if (
		status === 429 ||
		parsed?.error?.status === "RESOURCE_EXHAUSTED" ||
		/quota exceeded|resource_exhausted|rate limit/i.test(apiMessage ?? errorText)
	) {
		const retrySuffix =
			typeof retryDelay === "number"
				? ` Try again in about ${retryDelay} seconds.`
				: " Try again shortly.";
		return `Gemini quota exceeded for ${model}. Check your Gemini plan or billing details, or switch models.${retrySuffix}`;
	}

	if (
		status === 401 ||
		status === 403 ||
		/invalid api key|api key not valid|permission denied|forbidden|unauthenticated/i.test(
			apiMessage ?? errorText,
		)
	) {
		return "Gemini authentication failed. Check your Google Gemini API key in Settings and try again.";
	}

	if (apiMessage) {
		return `Gemini request failed: ${apiMessage.split("\n")[0]?.trim() ?? apiMessage}`;
	}

	return errorText
		? `Gemini request failed with status ${status}.`
		: `Gemini request failed with status ${status}.`;
}

function parseGeminiApiError(errorText: string): GeminiApiErrorPayload | null {
	if (!errorText.trim()) {
		return null;
	}
	try {
		return JSON.parse(errorText) as GeminiApiErrorPayload;
	} catch {
		return null;
	}
}

function getRetryDelaySeconds(payload: GeminiApiErrorPayload | null): number | null {
	const retryDelay = payload?.error?.details?.find(
		(detail) => detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
	)?.retryDelay;
	if (!retryDelay) {
		return null;
	}
	const match = /^(\d+)/.exec(retryDelay);
	if (!match) {
		return null;
	}
	return Number(match[1]);
}
