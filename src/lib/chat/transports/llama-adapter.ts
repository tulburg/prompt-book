import {
	buildLMStudioChatCompletionRequest,
	filterModelTextContent,
	toUserFacingLMStudioServerErrorMessage,
} from "../lm-studio-chat-codec";
import type { AnthropicRequest, ChatTransportEvent } from "../types";

const DEFAULT_SERVER_URL = "http://localhost:8123";

export class LlamaChatAdapter {
	async *stream(
		request: AnthropicRequest,
		options: { signal: AbortSignal; serverUrl?: string },
	): AsyncGenerator<ChatTransportEvent> {
		const baseUrl = (options.serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
		const lmsPayload = buildLMStudioChatCompletionRequest(request);
		const url = `${baseUrl}/v1/chat/completions`;
		console.log("[LlamaAdapter] POST", url);
		console.log("[LlamaAdapter] request.model:", request.model);
		console.log("[LlamaAdapter] request.format:", request.format);
		console.log("[LlamaAdapter] payload.model:", lmsPayload.model);
		console.log("[LlamaAdapter] payload.stop:", lmsPayload.stop);
		console.log("[LlamaAdapter] payload.messages:", lmsPayload.messages.map((m) => ({ role: m.role, contentLength: m.content.length, contentPreview: m.content.slice(0, 100) })));
		console.log("[LlamaAdapter] FULL payload:", JSON.stringify(lmsPayload));
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(lmsPayload),
			signal: options.signal,
		});

		console.log("[LlamaAdapter] response status:", response.status, "content-type:", response.headers.get("content-type"));

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			console.error("[LlamaAdapter] request failed:", response.status, errorText);
			throw new Error(
				toUserFacingLMStudioServerErrorMessage(
					`LM Studio chat completions request failed with status ${response.status}${errorText ? `: ${errorText}` : ""}`,
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
								delta?: { content?: string | Array<{ type?: string; text?: string }> };
								message?: { content?: string | Array<{ type?: string; text?: string }> };
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
							if (!raw) continue;
							yield { type: "content_delta", text: raw };
						}
					} catch {
						// Ignore malformed SSE frames from the local model server.
					}
				}
			}
			console.log(`[LlamaAdapter] SSE stream ended, total frames: ${_sseFrameCount}`);
		} else {
			const payload = (await response.json()) as {
				choices?: Array<{
					message?: { content?: string | Array<{ type?: string; text?: string }> };
				}>;
			};

			for (const choice of payload.choices ?? []) {
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
		}

		yield { type: "message_stop" };
	}
}
