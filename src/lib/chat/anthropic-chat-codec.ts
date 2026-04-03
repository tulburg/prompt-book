import type { AnthropicRequest } from "./types";

export interface AnthropicMessagesRequest {
	model: string;
	system?: string;
	messages: Array<{
		role: "user" | "assistant";
		content: Array<{ type: "text"; text: string }>;
	}>;
	max_tokens: number;
	stream: boolean;
	temperature: number;
}

export function buildAnthropicMessagesRequest(
	request: AnthropicRequest,
): AnthropicMessagesRequest {
	return {
		model: request.model,
		system: request.system
			.map((section) => section.trim())
			.filter(Boolean)
			.join("\n\n"),
		messages: request.messages
			.filter(
				(message): message is typeof message & {
					role: "user" | "assistant";
					content: Array<{ type: "text"; text: string }>;
				} =>
					(message.role === "user" || message.role === "assistant") &&
					Array.isArray(message.content) &&
					message.content.length > 0,
			)
			.map((message) => ({
				role: message.role,
				content: message.content.filter(
					(block): block is { type: "text"; text: string } =>
						block.type === "text" && typeof block.text === "string",
				),
			})),
		max_tokens: 4096,
		stream: request.stream,
		temperature: 0.7,
	};
}
