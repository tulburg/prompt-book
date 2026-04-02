import type { AnthropicRequest, ChatTransportEvent } from "../types";

const DEFAULT_SERVER_URL = "http://localhost:8123";

interface LlamaChatCompletionRequest {
	model: string;
	messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
	stream: boolean;
}

function flattenBlocks(
	content: string | Array<{ type?: string; text?: string }> | undefined | null,
): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content.map((block) => (typeof block?.text === "string" ? block.text : "")).join("");
	}
	return "";
}

export function buildLlamaChatPayload(request: AnthropicRequest): LlamaChatCompletionRequest {
	const systemText = request.system.join("\n\n");
	const messages: LlamaChatCompletionRequest["messages"] = [
		{ role: "system", content: systemText },
		...request.messages.map((message) => ({
			role: message.role,
			content: message.content.map((block) => block.text).join(""),
		})),
	];

	return {
		model: request.model,
		messages,
		stream: request.stream,
	};
}

export class LlamaChatAdapter {
	async *stream(
		request: AnthropicRequest,
		options: { signal: AbortSignal; serverUrl?: string },
	): AsyncGenerator<ChatTransportEvent> {
		const baseUrl = (options.serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
		const response = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(buildLlamaChatPayload(request)),
			signal: options.signal,
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => "");
			throw new Error(
				`Chat request failed: HTTP ${response.status}${errorText ? ` — ${errorText}` : ""}`,
			);
		}

		yield { type: "message_start" };
		const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
		const isSSE = contentType.includes("text/event-stream") && response.body;

		if (isSSE) {
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

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

					try {
						const parsed = JSON.parse(data) as {
							choices?: Array<{
								delta?: { content?: string | Array<{ type?: string; text?: string }> };
								message?: { content?: string | Array<{ type?: string; text?: string }> };
							}>;
						};
						for (const choice of parsed.choices ?? []) {
							const source = choice.delta ?? choice.message;
							const raw = flattenBlocks(source?.content);
							if (!raw) continue;
							yield { type: "content_delta", text: raw };
						}
					} catch {
						// Ignore malformed SSE frames from the local model server.
					}
				}
			}
		} else {
			const payload = (await response.json()) as {
				choices?: Array<{
					message?: { content?: string | Array<{ type?: string; text?: string }> };
				}>;
			};

			for (const choice of payload.choices ?? []) {
				const raw = flattenBlocks(choice.message?.content);
				if (!raw) continue;
				yield { type: "content_delta", text: raw };
			}
		}

		yield { type: "message_stop" };
	}
}
