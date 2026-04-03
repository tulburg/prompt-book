import { buildAnthropicMessagesRequest } from "../anthropic-chat-codec";
import type { AnthropicRequest, ChatTransportEvent } from "../types";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicChatAdapter {
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
				"Anthropic API key is missing. Add it in Settings to use Claude models.",
			);
		}

		const response = await fetch(ANTHROPIC_MESSAGES_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": ANTHROPIC_VERSION,
				"anthropic-dangerous-direct-browser-access": "true",
			},
			body: JSON.stringify(buildAnthropicMessagesRequest(request)),
			signal: options.signal,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(
				toUserFacingAnthropicErrorMessage(
					response.status,
					errorText,
					request.model,
				),
			);
		}

		yield { type: "message_start" };

		const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
		if (contentType.includes("text/event-stream") && response.body) {
			const reader = response.body.getReader();
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
					const frame = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const parsed = parseAnthropicSseFrame(frame);
					if (!parsed?.data) {
						continue;
					}
					if (parsed.event === "message_stop") {
						yield { type: "message_stop" };
						return;
					}
					if (parsed.event !== "content_block_delta") {
						continue;
					}
					const payload = JSON.parse(parsed.data) as AnthropicStreamDelta;
					if (payload.delta?.type === "text_delta" && payload.delta.text) {
						yield { type: "content_delta", text: payload.delta.text };
					}
				}
			}
		} else {
			const payload = (await response.json()) as {
				content?: Array<{ type?: string; text?: string }>;
			};
			for (const block of payload.content ?? []) {
				if (block.type === "text" && block.text) {
					yield { type: "content_delta", text: block.text };
				}
			}
		}

		yield { type: "message_stop" };
	}
}

type AnthropicSseFrame = {
	event?: string;
	data?: string;
};

type AnthropicStreamDelta = {
	delta?: {
		type?: string;
		text?: string;
	};
};

type AnthropicApiErrorPayload = {
	error?: {
		type?: string;
		message?: string;
	};
};

function parseAnthropicSseFrame(frame: string): AnthropicSseFrame | null {
	const parsed: AnthropicSseFrame = {};
	for (const line of frame.split("\n")) {
		if (line.startsWith(":")) {
			continue;
		}
		const separator = line.indexOf(":");
		if (separator === -1) {
			continue;
		}
		const field = line.slice(0, separator);
		const value =
			line[separator + 1] === " "
				? line.slice(separator + 2)
				: line.slice(separator + 1);
		if (field === "event") {
			parsed.event = value;
		} else if (field === "data") {
			parsed.data = parsed.data ? `${parsed.data}\n${value}` : value;
		}
	}
	return parsed.event || parsed.data ? parsed : null;
}

function toUserFacingAnthropicErrorMessage(
	status: number,
	errorText: string,
	model: string,
): string {
	const parsed = parseAnthropicApiError(errorText);
	const apiMessage = parsed?.error?.message?.trim();
	const errorType = parsed?.error?.type?.trim().toLowerCase();

	if (
		status === 429 ||
		errorType === "rate_limit_error" ||
		/rate limit|too many requests/i.test(apiMessage ?? errorText)
	) {
		return `Anthropic rate limit exceeded for ${model}. Wait a moment and try again, or switch models.`;
	}

	if (
		status === 401 ||
		status === 403 ||
		errorType === "authentication_error" ||
		/invalid x-api-key|api key|authentication/i.test(apiMessage ?? errorText)
	) {
		return "Anthropic authentication failed. Check your Anthropic API key in Settings and try again.";
	}

	if (status === 529 || /overloaded|overload/i.test(apiMessage ?? errorText)) {
		return "Anthropic is temporarily overloaded. Please try again in a moment.";
	}

	if (apiMessage) {
		return `Anthropic request failed: ${apiMessage.split("\n")[0]?.trim() ?? apiMessage}`;
	}

	return `Anthropic request failed with status ${status}.`;
}

function parseAnthropicApiError(
	errorText: string,
): AnthropicApiErrorPayload | null {
	if (!errorText.trim()) {
		return null;
	}
	try {
		return JSON.parse(errorText) as AnthropicApiErrorPayload;
	} catch {
		return null;
	}
}
