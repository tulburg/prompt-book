import { normalizeMessagesForAnthropic } from "./normalize-messages";
import type { AnthropicMessage, AnthropicRequest, ChatQueryContext, ChatSessionState } from "./types";

function serializeContext(
	tagName: "system-reminder" | "system-context",
	context: Record<string, string>,
): string | null {
	const entries = Object.entries(context).filter(([, value]) => value.trim().length > 0);
	if (entries.length === 0) return null;

	const lines = entries.map(([key, value]) => `${key}: ${value}`);
	return `<${tagName}>\n${lines.join("\n")}\n</${tagName}>`;
}

export function prependUserContext(
	messages: AnthropicMessage[],
	userContext: Record<string, string>,
): AnthropicMessage[] {
	const serialized = serializeContext("system-reminder", userContext);
	if (!serialized) return messages;

	return [
		{
			role: "user",
			content: [{ type: "text", text: serialized }],
		},
		...messages,
	];
}

export function appendSystemContext(
	systemPrompt: string[],
	systemContext: Record<string, string>,
): string[] {
	const serialized = serializeContext("system-context", systemContext);
	if (!serialized) return systemPrompt;
	return [...systemPrompt, serialized];
}

function appendPlainContext(
	systemPrompt: string[],
	systemContext: Record<string, string>,
	userContext: Record<string, string>,
): string[] {
	const sections: string[] = [...systemPrompt];
	const plainSystemContext = Object.entries(systemContext)
		.filter(([, value]) => value.trim().length > 0)
		.map(([key, value]) => `- ${key}: ${value}`);
	const plainUserContext = Object.entries(userContext)
		.filter(([, value]) => value.trim().length > 0)
		.map(([key, value]) => `- ${key}: ${value}`);

	if (plainSystemContext.length > 0) {
		sections.push(["# Runtime Context", ...plainSystemContext].join("\n"));
	}
	if (plainUserContext.length > 0) {
		sections.push(["# User Context", ...plainUserContext].join("\n"));
	}

	return sections;
}

export function resolveRequestFormat(model: string): AnthropicRequest["format"] {
	return /qwen/i.test(model) ? "qwen" : "anthropic";
}

export function buildAnthropicRequest({
	session,
	queryContext,
	model,
}: {
	session: ChatSessionState;
	queryContext: ChatQueryContext;
	model: string;
}): AnthropicRequest {
	const normalizedMessages = normalizeMessagesForAnthropic(session.transcript);
	const format = resolveRequestFormat(model);

	return {
		model,
		system:
			format === "qwen"
				? appendPlainContext(
						queryContext.systemPrompt,
						queryContext.systemContext,
						queryContext.userContext,
					)
				: appendSystemContext(queryContext.systemPrompt, queryContext.systemContext),
		messages:
			format === "qwen"
				? normalizedMessages
				: prependUserContext(normalizedMessages, queryContext.userContext),
		stream: true,
		format,
		metadata: {
			sessionId: session.id,
			mode: session.mode,
			provider: "llama",
		},
	};
}
