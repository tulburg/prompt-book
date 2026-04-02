import {
	buildLlamaChatCompletionRequest,
	filterModelTextContent,
	toUserFacingLlamaServerErrorMessage,
} from "../llama-chat-codec";
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
		console.log("[LlamaAdapter] POST", url);
		console.log("[LlamaAdapter] request.model:", request.model);
		console.log("[LlamaAdapter] request.format:", request.format);
		console.log("[LlamaAdapter] payload.model:", llamaPayload.model);
		console.log("[LlamaAdapter] payload.stop:", llamaPayload.stop);
		console.log("[LlamaAdapter] payload.messages:", llamaPayload.messages.map((m) => ({ role: m.role, contentLength: m.content?.length ?? 0, contentPreview: m.content?.slice(0, 100) ?? "" })));
		console.log("[LlamaAdapter] FULL payload:", JSON.stringify(llamaPayload));
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(llamaPayload),
			signal: options.signal,
		});

		console.log("[LlamaAdapter] response status:", response.status, "content-type:", response.headers.get("content-type"));

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
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
			const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

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
					if (_sseFrameCount <= 10) {
						console.log(`[LlamaAdapter] SSE frame #${_sseFrameCount} raw:`, data.slice(0, 500));
					}

					try {
						const parsed = JSON.parse(data) as {
							choices?: Array<{
								delta?: {
									content?: string | Array<{ type?: string; text?: string }>;
									tool_calls?: Array<{
										index?: number;
										id?: string;
										type?: string;
										function?: { name?: string; arguments?: string };
									}>;
								};
								message?: {
									content?: string | Array<{ type?: string; text?: string }>;
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
							const beforeFilter =
								typeof source?.content === "string"
									? source.content
									: Array.isArray(source?.content)
										? source.content
												.map((block) =>
													typeof block?.text === "string" ? block.text : "",
												)
												.join("")
										: "";
							const raw = filterModelTextContent(beforeFilter);
							if (_sseFrameCount <= 10) {
								console.log(`[LlamaAdapter] SSE frame #${_sseFrameCount} content before filter: ${JSON.stringify(beforeFilter.slice(0, 200))}`);
								console.log(`[LlamaAdapter] SSE frame #${_sseFrameCount} content after filter: ${JSON.stringify(raw.slice(0, 200))}`);
							}
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
							if (!raw) continue;
							yield { type: "content_delta", text: raw };
						}
					} catch {
						// Ignore malformed SSE frames from the local model server.
					}
				}
			}
			console.log(`[LlamaAdapter] SSE stream ended, total frames: ${_sseFrameCount}`);
			if (toolCalls.size > 0) {
				yield {
					type: "tool_calls",
					calls: [...toolCalls.values()].map((call) => ({
						id: call.id,
						name: call.name,
						input: safeParseToolArguments(call.arguments),
					})),
				};
			}
		} else {
			const payload = (await response.json()) as {
				choices?: Array<{
					message?: {
						content?: string | Array<{ type?: string; text?: string }>;
						tool_calls?: Array<{
							id?: string;
							function?: { name?: string; arguments?: string };
						}>;
					};
				}>;
			};

			const toolCalls: Array<{ id: string; name: string; input: JsonObject }> = [];
			for (const choice of payload.choices ?? []) {
				for (const toolCall of choice.message?.tool_calls ?? []) {
					toolCalls.push({
						id: toolCall.id ?? `tool-call-${toolCalls.length}`,
						name: toolCall.function?.name ?? "",
						input: safeParseToolArguments(toolCall.function?.arguments ?? ""),
					});
				}
				const raw = filterModelTextContent(
					typeof choice.message?.content === "string"
						? choice.message.content
						: Array.isArray(choice.message?.content)
							? choice.message.content
									.map((block) => (typeof block?.text === "string" ? block.text : ""))
									.join("")
							: "",
				);
				if (!raw) continue;
				yield { type: "content_delta", text: raw };
			}
			if (toolCalls.length > 0) {
				yield { type: "tool_calls", calls: toolCalls };
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
