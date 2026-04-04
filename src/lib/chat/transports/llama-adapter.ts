import {
	buildLlamaChatCompletionRequest,
	filterModelTextContent,
	toUserFacingLlamaServerErrorMessage,
} from "../llama-chat-codec";
import {
	mergeParsedToolCalls,
	parseToolCallsFromText,
	shouldCaptureToolCallText,
} from "../tool-call-parser";
import {
	extractReasoningText,
	extractVisibleTextContent,
} from "../thinking-tags";
import type { AnthropicRequest, ChatTransportEvent } from "../types";
import type { JsonObject } from "../tools/tool-types";

const DEFAULT_SERVER_URL = "http://localhost:48123";

export class LlamaChatAdapter {
	async *stream(
		request: AnthropicRequest,
		options: { signal: AbortSignal; serverUrl?: string },
	): AsyncGenerator<ChatTransportEvent> {
		if (options.signal.aborted) {
			throw new DOMException("Aborted", "AbortError");
		}
		const baseUrl = (options.serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
		const llamaPayload = buildLlamaChatCompletionRequest(request);
		const url = `${baseUrl}/v1/chat/completions`;
		const fetchStartMs = Date.now();
		console.log("[LlamaAdapter] POST", url, {
			model: llamaPayload.model,
			format: request.format,
			messageCount: llamaPayload.messages.length,
			toolCount: llamaPayload.tools?.length ?? 0,
			stop: llamaPayload.stop,
		});

		const MAX_RETRIES = 3;
		const body = JSON.stringify(llamaPayload);
		let response!: Response;

		for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
			try {
				response = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body,
					signal: options.signal,
				});
			} catch (error) {
				const elapsed = Date.now() - fetchStartMs;
				const msg = error instanceof Error ? error.message : String(error);
				const name = error instanceof Error ? error.name : "Unknown";
				if (name === "AbortError" || attempt >= MAX_RETRIES) {
					console.error(`[LlamaAdapter] fetch FAILED (attempt ${attempt}/${MAX_RETRIES}) after ${elapsed}ms: name=${name}, message=${msg}`);
					throw error;
				}
				const backoffMs = attempt * 2000;
				console.warn(`[LlamaAdapter] fetch error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoffMs}ms: ${msg}`);
				await new Promise((r) => setTimeout(r, backoffMs));
				continue;
			}

			console.log(`[LlamaAdapter] response (attempt ${attempt}): status=${response.status}, content-type=${response.headers.get("content-type")}`);

			if (response.ok) {
				break;
			}

			const errorText = await response.text().catch(() => "");
			if (response.status >= 500 && attempt < MAX_RETRIES) {
				const backoffMs = attempt * 2000;
				console.warn(`[LlamaAdapter] server error ${response.status} (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoffMs}ms: ${errorText.slice(0, 200)}`);
				await new Promise((r) => setTimeout(r, backoffMs));
				continue;
			}

			console.error("[LlamaAdapter] request failed:", response.status, errorText);
			throw new Error(
				toUserFacingLlamaServerErrorMessage(
					`Llama server chat completions request failed with status ${response.status}${errorText ? `: ${errorText}` : ""}`,
				),
			);
		}

		yield { type: "message_start" };
		const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
		const isSSE = contentType.includes("text/event-stream") && response.body;

		if (isSSE) {
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let _sseFrameCount = 0;
			let totalBytesRead = 0;
			const streamStartMs = Date.now();
			const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
			const textFragments: string[] = [];
			const parserCandidateFragments: string[] = [];
			let bufferedToolCallText = "";
			let thinkingOpen = false;

			while (true) {
				let readResult: ReadableStreamReadResult<Uint8Array>;
				try {
					readResult = await reader.read();
				} catch (error) {
					const elapsed = Date.now() - streamStartMs;
					const msg = error instanceof Error ? error.message : String(error);
					const name = error instanceof Error ? error.name : "Unknown";
					console.error(`[LlamaAdapter] SSE reader.read() FAILED after ${elapsed}ms, ${totalBytesRead} bytes, ${_sseFrameCount} frames: name=${name}, message=${msg}`);
					throw error;
				}
				const { done, value } = readResult;
				if (done) {
					console.log(`[LlamaAdapter] SSE stream done: ${Date.now() - streamStartMs}ms, ${totalBytesRead} bytes, ${_sseFrameCount} frames`);
					break;
				}
				totalBytesRead += value.byteLength;

				buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

				while (true) {
					const boundary = buffer.indexOf("\n\n");
					if (boundary === -1) break;

					const eventBlock = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const data = eventBlock
						.split("\n")
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).trimStart())
						.join("\n")
						.trim();

					if (!data || data === "[DONE]") continue;

					_sseFrameCount++;
					if (_sseFrameCount <= 3) {
						console.log(`[LlamaAdapter] SSE frame #${_sseFrameCount} raw:`, data.slice(0, 300));
					}

					try {
						const parsed = JSON.parse(data) as {
							choices?: Array<{
								delta?: {
									content?: string | Array<{ type?: string; text?: string }>;
									reasoning_content?: string;
									tool_calls?: Array<{
										index?: number;
										id?: string;
										type?: string;
										function?: { name?: string; arguments?: string };
									}>;
								};
								message?: {
									content?: string | Array<{ type?: string; text?: string }>;
									reasoning_content?: string;
									tool_calls?: Array<{
										index?: number;
										id?: string;
										type?: string;
										function?: { name?: string; arguments?: string };
									}>;
								};
							}>;
						};
						for (const choice of parsed.choices ?? []) {
							const source = choice.delta ?? choice.message;
							const events: ChatTransportEvent[] = [];
							const closeThinkingIfNeeded = () => {
								if (!thinkingOpen) return;
								events.push({ type: "content_delta", text: "</think>" });
								thinkingOpen = false;
							};
							const captureToolText = (fragment: string): boolean => {
								if (!llamaPayload.tools?.length) {
									return false;
								}
								if (!shouldCaptureToolCallText(fragment, bufferedToolCallText)) {
									return false;
								}
								bufferedToolCallText += fragment;
								parserCandidateFragments.push(fragment);
								return true;
							};

							const reasoning = filterModelTextContent(
								extractReasoningText(source),
							);
							if (reasoning) {
								if (!captureToolText(reasoning)) {
									if (!thinkingOpen) {
										events.push({ type: "content_delta", text: "<think>" });
										thinkingOpen = true;
									}
									events.push({ type: "content_delta", text: reasoning });
								}
							}

							const raw = filterModelTextContent(
								extractVisibleTextContent(source?.content),
							);
							for (const toolCall of source?.tool_calls ?? []) {
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
							if ((source?.tool_calls?.length ?? 0) > 0) {
								closeThinkingIfNeeded();
							}
							if (raw) {
								if (!captureToolText(raw)) {
									closeThinkingIfNeeded();
									textFragments.push(raw);
									events.push({ type: "content_delta", text: raw });
								}
							}
							for (const event of events) {
								yield event;
							}
						}
					} catch {
						// Ignore malformed SSE frames from the local model server.
					}
				}
			}
			console.log(`[LlamaAdapter] SSE stream ended, total frames: ${_sseFrameCount}`);
			if (thinkingOpen) {
				yield { type: "content_delta", text: "</think>" };
			}
			const parsedToolCalls = parseToolCallsFromText(
				parserCandidateFragments.length
					? parserCandidateFragments.join("")
					: textFragments.join(""),
			);
			if (parsedToolCalls.length > 0) {
				console.log(
					"[LlamaAdapter] Parsed fallback tool calls:",
					parsedToolCalls.map((call) => call.name),
				);
			}
			const mergedToolCalls = mergeParsedToolCalls(
				[...toolCalls.values()].map((call) => ({
					id: call.id,
					name: call.name,
					input: safeParseToolArguments(call.arguments),
				})),
				parsedToolCalls,
			);
			if (mergedToolCalls.length > 0) {
				yield {
					type: "tool_calls",
					calls: mergedToolCalls,
				};
			} else if (parserCandidateFragments.length > 0) {
				console.log(
					"[LlamaAdapter] No parsed tool calls from captured text, surfacing raw fallback text",
				);
				yield {
					type: "content_delta",
					text: parserCandidateFragments.join(""),
				};
			}
		} else {
			const payload = (await response.json()) as {
				choices?: Array<{
					message?: {
						content?: string | Array<{ type?: string; text?: string }>;
						reasoning_content?: string;
						tool_calls?: Array<{
							id?: string;
							function?: { name?: string; arguments?: string };
						}>;
					};
				}>;
			};

			const toolCalls: Array<{ id: string; name: string; input: JsonObject }> = [];
			const textFragments: string[] = [];
			const parserCandidateFragments: string[] = [];
			let bufferedToolCallText = "";
			let thinkingOpen = false;
			for (const choice of payload.choices ?? []) {
				const events: ChatTransportEvent[] = [];
				const closeThinkingIfNeeded = () => {
					if (!thinkingOpen) return;
					events.push({ type: "content_delta", text: "</think>" });
					thinkingOpen = false;
				};
				const captureToolText = (fragment: string): boolean => {
					if (!llamaPayload.tools?.length) {
						return false;
					}
					if (!shouldCaptureToolCallText(fragment, bufferedToolCallText)) {
						return false;
					}
					bufferedToolCallText += fragment;
					parserCandidateFragments.push(fragment);
					return true;
				};

				const reasoning = filterModelTextContent(
					extractReasoningText(choice.message),
				);
				if (reasoning && !captureToolText(reasoning)) {
					if (!thinkingOpen) {
						events.push({ type: "content_delta", text: "<think>" });
						thinkingOpen = true;
					}
					events.push({ type: "content_delta", text: reasoning });
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
				const raw = filterModelTextContent(
					extractVisibleTextContent(choice.message?.content),
				);
				if (raw) {
					if (!captureToolText(raw)) {
						closeThinkingIfNeeded();
						textFragments.push(raw);
						events.push({ type: "content_delta", text: raw });
					}
				}
				for (const event of events) {
					yield event;
				}
			}
			if (thinkingOpen) {
				yield { type: "content_delta", text: "</think>" };
			}
			const parsedToolCalls = parseToolCallsFromText(
				parserCandidateFragments.length
					? parserCandidateFragments.join("")
					: textFragments.join(""),
			);
			if (parsedToolCalls.length > 0) {
				console.log(
					"[LlamaAdapter] Parsed fallback tool calls:",
					parsedToolCalls.map((call) => call.name),
				);
			}
			const mergedToolCalls = mergeParsedToolCalls(toolCalls, parsedToolCalls);
			if (mergedToolCalls.length > 0) {
				yield { type: "tool_calls", calls: mergedToolCalls };
			} else if (parserCandidateFragments.length > 0) {
				console.log(
					"[LlamaAdapter] No parsed tool calls from captured text, surfacing raw fallback text",
				);
				yield {
					type: "content_delta",
					text: parserCandidateFragments.join(""),
				};
			}
		}

		yield { type: "message_stop" };
	}
}

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
