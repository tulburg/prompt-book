import { resolveChatModelProfile, type ChatModelProfile } from "./model-profiles";
import { normalizeMessagesForAnthropic } from "./normalize-messages";
import type { AnthropicRequest, ChatApiMessage, ChatQueryContext, ChatSessionState } from "./types";
import { buildToolInstructionSections } from "./tools/tool-instructions";
import { getAvailableChatTools, getNativeToolDefinitions } from "./tools/tool-registry";
import { supportsNativeToolCalling } from "./tools/tool-capabilities";
import type { ChatToolContext } from "./tools/tool-types";

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
	messages: ChatApiMessage[],
	userContext: Record<string, string>,
): ChatApiMessage[] {
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

function collapseSystemSections(
	sections: string[],
	separator: string,
): string[] {
	const nonEmpty = sections.filter((section) => section.trim().length > 0);
	if (nonEmpty.length <= 1) {
		return nonEmpty;
	}
	return [nonEmpty.join(separator)];
}

function buildSystemSections(
	profile: ChatModelProfile,
	queryContext: ChatQueryContext,
	toolContext?: ChatToolContext,
): string[] {
	const availableTools = toolContext ? getAvailableChatTools(toolContext) : [];
	const toolSections =
		profile.insertToolGuidance || (toolContext && supportsNativeToolCalling(profile))
			? buildToolInstructionSections(availableTools, {
					includeThinkingGuidance: profile.insertThinkingGuidance,
				})
			: [];
	const sections =
		profile.contextStyle === "plain_sections"
			? appendPlainContext(
					queryContext.systemPrompt,
					queryContext.systemContext,
					queryContext.userContext,
				)
			: appendSystemContext(queryContext.systemPrompt, queryContext.systemContext);
	const combined = [...sections, ...toolSections];

	return profile.collapseSystemSections
		? collapseSystemSections(combined, profile.systemSeparator)
		: combined;
}

function buildRequestMessages(
	profile: ChatModelProfile,
	normalizedMessages: ChatApiMessage[],
	queryContext: ChatQueryContext,
): ChatApiMessage[] {
	return profile.injectUserContext
		? prependUserContext(normalizedMessages, queryContext.userContext)
		: normalizedMessages;
}

export function buildAnthropicRequest({
	session,
	queryContext,
	model,
	modelName,
	toolContext,
}: {
	session: ChatSessionState;
	queryContext: ChatQueryContext;
	model: string;
	modelName?: string | null;
	toolContext?: ChatToolContext;
}): AnthropicRequest {
	const profile = resolveChatModelProfile({ modelId: model, modelName });
	const normalizedMessages = normalizeMessagesForAnthropic(session.transcript, {
		toolResultMode: profile.toolResultMode,
	});
	const nativeToolCalling = Boolean(toolContext) && supportsNativeToolCalling(profile);
	const tools = toolContext && nativeToolCalling ? getNativeToolDefinitions(toolContext) : undefined;
	console.log("[RequestBuilder] resolved profile:", { modelId: model, modelName, profileId: profile.id, contextStyle: profile.contextStyle, injectUserContext: profile.injectUserContext, toolResultMode: profile.toolResultMode, nativeToolCalling, toolCount: tools?.length ?? 0 });

	return {
		model,
		system: buildSystemSections(profile, queryContext, toolContext),
		messages: buildRequestMessages(profile, normalizedMessages, queryContext),
		stream: true,
		format:
			profile.id === "anthropic" || profile.id === "default"
				? "anthropic"
				: profile.id === "openai" || profile.id === "qwen" || profile.id === "gemma"
					? profile.id
					: "anthropic",
		tools,
		tool_choice: tools && tools.length > 0 ? "auto" : "none",
		nativeToolCalling,
		metadata: {
			sessionId: session.id,
			mode: session.mode,
			provider: "llama",
		},
	};
}
