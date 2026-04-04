import { buildOpenAiChatCompletionRequest } from "../openai-chat-codec";
import {
	extractReasoningText,
	extractVisibleTextContent,
} from "../thinking-tags";
import type { JsonObject } from "../tools/tool-types";
import type { AnthropicRequest, ChatTransportEvent } from "../types";

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAiChatAdapter {
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
				"OpenAI API key is missing. Add it in Settings to use OpenAI models.",
			);
		}

		const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(buildOpenAiChatCompletionRequest(request)),
			signal: options.signal,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			const error = new Error(
				toUserFacingOpenAiErrorMessage(
					response.status,
					errorText,
					request.model,
					response.headers,
				),
			) as Error & { retryable?: boolean };
			error.retryable = response.status >= 500;
			throw error;
		}

		yield { type: "message_start" };

		const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
		if (contentType.includes("text/event-stream") && response.body) {
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
			let thinkingOpen = false;

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

					const parsed = JSON.parse(data) as OpenAiChatCompletionChunk;
					for (const choice of parsed.choices ?? []) {
						const events: ChatTransportEvent[] = [];
						const closeThinkingIfNeeded = () => {
							if (!thinkingOpen) {
								return;
							}
							events.push({ type: "content_delta", text: "</think>" });
							thinkingOpen = false;
						};
						const reasoning = extractReasoningText(choice.delta);
						if (reasoning) {
							if (!thinkingOpen) {
								events.push({ type: "content_delta", text: "<think>" });
								thinkingOpen = true;
							}
							events.push({ type: "content_delta", text: reasoning });
						}
						const content = extractVisibleTextContent(choice.delta?.content);
						if (content) {
							closeThinkingIfNeeded();
							events.push({ type: "content_delta", text: content });
						}
						for (const toolCall of choice.delta?.tool_calls ?? []) {
							const index = toolCall.index ?? 0;
							const previous = toolCalls.get(index) ?? {
								id: toolCall.id ?? `tool-call-${index}`,
								name: "",
								arguments: "",
							};
							toolCalls.set(index, {
								id: toolCall.id ?? previous.id,
								name: toolCall.function?.name ?? previous.name,
								arguments: `${previous.arguments}${toolCall.function?.arguments ?? ""}`,
							});
						}
						if ((choice.delta?.tool_calls?.length ?? 0) > 0) {
							closeThinkingIfNeeded();
						}
						for (const event of events) {
							yield event;
						}
					}
				}
			}

			if (thinkingOpen) {
				yield { type: "content_delta", text: "</think>" };
			}
			const resolvedToolCalls = [...toolCalls.values()]
				.map((call) => ({
					id: call.id,
					name: call.name,
					input: safeParseToolArguments(call.arguments),
				}))
				.filter((call) => call.name);
			if (resolvedToolCalls.length > 0) {
				yield { type: "tool_calls", calls: resolvedToolCalls };
			}
		} else {
			const payload = (await response.json()) as OpenAiChatCompletionResponse;
			const toolCalls: Array<{ id: string; name: string; input: JsonObject }> = [];
			let thinkingOpen = false;
			for (const choice of payload.choices ?? []) {
				const events: ChatTransportEvent[] = [];
				const closeThinkingIfNeeded = () => {
					if (!thinkingOpen) {
						return;
					}
					events.push({ type: "content_delta", text: "</think>" });
					thinkingOpen = false;
				};
				const reasoning = extractReasoningText(choice.message);
				if (reasoning) {
					if (!thinkingOpen) {
						events.push({ type: "content_delta", text: "<think>" });
						thinkingOpen = true;
					}
					events.push({ type: "content_delta", text: reasoning });
				}
				const content = extractVisibleTextContent(choice.message?.content);
				if (content) {
					closeThinkingIfNeeded();
					events.push({ type: "content_delta", text: content });
				}
				for (const toolCall of choice.message?.tool_calls ?? []) {
					toolCalls.push({
						id: toolCall.id ?? `tool-call-${toolCalls.length}`,
						name: toolCall.function?.name ?? "",
						input: safeParseToolArguments(toolCall.function?.arguments ?? ""),
					});
				}
				if ((choice.message?.tool_calls?.length ?? 0) > 0) {
					closeThinkingIfNeeded();
				}
				for (const event of events) {
					yield event;
				}
			}
			if (thinkingOpen) {
				yield { type: "content_delta", text: "</think>" };
			}
			if (toolCalls.length > 0) {
				yield { type: "tool_calls", calls: toolCalls.filter((call) => call.name) };
			}
		}

		yield { type: "message_stop" };
	}
}

type OpenAiToolCallChunk = {
	index?: number;
	id?: string;
	function?: {
		name?: string;
		arguments?: string;
	};
};

type OpenAiChatCompletionChunk = {
	choices?: Array<{
		delta?: {
			content?: string | Array<{ type?: string; text?: string }>;
			reasoning_content?: string;
			reasoning?: unknown;
			reasoning_text?: unknown;
			thinking?: unknown;
			tool_calls?: OpenAiToolCallChunk[];
		};
	}>;
};

type OpenAiChatCompletionResponse = {
	choices?: Array<{
		message?: {
			content?: string | Array<{ type?: string; text?: string }>;
			reasoning_content?: string;
			reasoning?: unknown;
			reasoning_text?: unknown;
			thinking?: unknown;
			tool_calls?: Array<{
				id?: string;
				function?: {
					name?: string;
					arguments?: string;
				};
			}>;
		};
	}>;
};

type OpenAiApiErrorPayload = {
	error?: {
		message?: string;
		type?: string;
		code?: string;
	};
};

function safeParseToolArguments(raw: string): JsonObject {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as JsonObject;
		}
		return { value: (parsed ?? null) as string | number | boolean | null };
	} catch {
		return raw ? { raw } : {};
	}
}

function toUserFacingOpenAiErrorMessage(
	status: number,
	errorText: string,
	model: string,
	headers?: Headers,
): string {
	const parsed = parseOpenAiApiError(errorText);
	const apiMessage = parsed?.error?.message?.trim();
	const errorType = parsed?.error?.type?.trim().toLowerCase();
	const errorCode = parsed?.error?.code?.trim().toLowerCase();

	if (
		status === 429 ||
		errorType === "rate_limit_error" ||
		errorCode === "rate_limit_exceeded" ||
		errorCode === "insufficient_quota" ||
		/rate limit|quota/i.test(apiMessage ?? errorText)
	) {
		const retryAfterSeconds = getRetryAfterSeconds(headers);
		const retrySuffix =
			typeof retryAfterSeconds === "number"
				? ` Try again in about ${retryAfterSeconds} seconds.`
				: " Wait a moment and try again, or switch models.";
		return `OpenAI rate limit exceeded for ${model}.${retrySuffix}`;
	}

	if (
		status === 401 ||
		status === 403 ||
		(errorType === "invalid_request_error" &&
			/api key/i.test(apiMessage ?? errorText)) ||
		/incorrect api key|invalid api key|authentication/i.test(apiMessage ?? errorText)
	) {
		return "OpenAI authentication failed. Check your OpenAI API key in Settings and try again.";
	}

	if (apiMessage) {
		return `OpenAI request failed: ${apiMessage.split("\n")[0]?.trim() ?? apiMessage}`;
	}

	return `OpenAI request failed with status ${status}.`;
}

function parseOpenAiApiError(errorText: string): OpenAiApiErrorPayload | null {
	if (!errorText.trim()) {
		return null;
	}
	try {
		return JSON.parse(errorText) as OpenAiApiErrorPayload;
	} catch {
		return null;
	}
}

function getRetryAfterSeconds(headers: Headers | undefined): number | null {
	const retryAfter = headers?.get("retry-after")?.trim();
	if (!retryAfter) {
		return null;
	}
	if (/^\d+$/.test(retryAfter)) {
		return Number(retryAfter);
	}
	const retryAtMs = Date.parse(retryAfter);
	if (Number.isNaN(retryAtMs)) {
		return null;
	}
	return Math.max(1, Math.ceil((retryAtMs - Date.now()) / 1000));
}
