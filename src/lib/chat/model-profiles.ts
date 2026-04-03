export interface ChatModelProfileInput {
	modelId: string;
	modelName?: string | null;
}

export interface ChatModelProfile {
	id: "anthropic" | "openai" | "qwen" | "gemma" | "gemini" | "default";
	modelFamilies?: readonly string[];
	exactModelIds?: readonly string[];
	modelNameTokens?: readonly string[];
	contextStyle: "anthropic_xml" | "plain_sections";
	injectUserContext: boolean;
	collapseSystemSections: boolean;
	insertToolGuidance: boolean;
	insertThinkingGuidance: boolean;
	toolResultMode: "tool" | "user";
	httpRolePattern: "openai" | "alternatingUserAssistant";
	systemSeparator: string;
	nativeToolCalling: "supported" | "unsupported";
}

const CHAT_MODEL_PROFILES: readonly ChatModelProfile[] = [
	{
		id: "openai",
		modelFamilies: ["openai"],
		modelNameTokens: ["openai/", "gpt-oss", "gpt_oss"],
		contextStyle: "plain_sections",
		injectUserContext: false,
		collapseSystemSections: false,
		insertToolGuidance: true,
		insertThinkingGuidance: true,
		toolResultMode: "tool",
		httpRolePattern: "openai",
		systemSeparator: "\n\n",
		nativeToolCalling: "supported",
	},
	{
		id: "qwen",
		modelFamilies: ["qwen"],
		modelNameTokens: ["qwen"],
		contextStyle: "plain_sections",
		injectUserContext: false,
		collapseSystemSections: true,
		insertToolGuidance: false,
		insertThinkingGuidance: false,
		toolResultMode: "tool",
		httpRolePattern: "openai",
		systemSeparator: "\n\n",
		nativeToolCalling: "supported",
	},
	{
		id: "gemma",
		modelFamilies: ["gemma"],
		modelNameTokens: ["gemma"],
		contextStyle: "plain_sections",
		injectUserContext: false,
		collapseSystemSections: true,
		insertToolGuidance: true,
		insertThinkingGuidance: true,
		toolResultMode: "user",
		httpRolePattern: "alternatingUserAssistant",
		systemSeparator: "\n\n",
		nativeToolCalling: "supported",
	},
	{
		id: "gemini",
		modelFamilies: ["google"],
		modelNameTokens: ["gemini"],
		contextStyle: "plain_sections",
		injectUserContext: false,
		collapseSystemSections: false,
		insertToolGuidance: true,
		insertThinkingGuidance: true,
		toolResultMode: "user",
		httpRolePattern: "openai",
		systemSeparator: "\n\n",
		nativeToolCalling: "unsupported",
	},
	{
		id: "anthropic",
		modelFamilies: ["anthropic", "claude"],
		modelNameTokens: ["anthropic", "claude"],
		contextStyle: "anthropic_xml",
		injectUserContext: true,
		collapseSystemSections: false,
		insertToolGuidance: false,
		insertThinkingGuidance: false,
		toolResultMode: "tool",
		httpRolePattern: "openai",
		systemSeparator: "\n\n",
		nativeToolCalling: "unsupported",
	},
	{
		id: "default",
		contextStyle: "plain_sections",
		injectUserContext: false,
		collapseSystemSections: true,
		insertToolGuidance: false,
		insertThinkingGuidance: false,
		toolResultMode: "tool",
		httpRolePattern: "openai",
		systemSeparator: "\n\n",
		nativeToolCalling: "supported",
	},
] as const;

function normalizeModelId(modelId: string | undefined): string | undefined {
	return modelId?.trim().toLowerCase();
}

function normalizeModelName(modelName: string | null | undefined): string | undefined {
	return modelName?.trim().toLowerCase();
}

function normalizeFamily(modelId: string | undefined): string | undefined {
	const normalized = normalizeModelId(modelId);
	if (!normalized) return undefined;
	const slashIndex = normalized.indexOf("/");
	return slashIndex === -1 ? normalized : normalized.slice(0, slashIndex);
}

function profileMatches(
	profile: ChatModelProfile,
	normalizedFamily: string | undefined,
	normalizedModelId: string | undefined,
	normalizedModelName: string | undefined,
): boolean {
	if (profile.exactModelIds?.includes(normalizedModelId ?? "")) {
		return true;
	}
	if (profile.modelFamilies?.includes(normalizedFamily ?? "")) {
		return true;
	}
	for (const token of profile.modelNameTokens ?? []) {
		if (normalizedModelId?.includes(token) || normalizedModelName?.includes(token)) {
			return true;
		}
	}
	return false;
}

export function resolveChatModelProfile(input: ChatModelProfileInput): ChatModelProfile {
	const normalizedModelId = normalizeModelId(input.modelId);
	const normalizedModelName = normalizeModelName(input.modelName);
	const normalizedFamily = normalizeFamily(input.modelId);
	return (
		CHAT_MODEL_PROFILES.find((profile) =>
			profileMatches(profile, normalizedFamily, normalizedModelId, normalizedModelName),
		) ?? CHAT_MODEL_PROFILES[CHAT_MODEL_PROFILES.length - 1]
	);
}
