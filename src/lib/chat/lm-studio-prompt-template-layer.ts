import type { AnthropicRequest } from "./types";

export function buildLMStudioSystemPrompt(request: AnthropicRequest): string | undefined {
	const systemMessages = request.system
		.map((message) => message.trim())
		.filter((message) => message.length > 0);

	return systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined;
}

export function buildLMStudioHistoryFingerprint(request: AnthropicRequest): string {
	return JSON.stringify({
		model: request.model,
		format: request.format,
		system: request.system,
		messages: request.messages.map((message) => ({
			role: message.role,
			content: message.content?.map((part) => part.text).join("") ?? "",
		})),
	});
}
