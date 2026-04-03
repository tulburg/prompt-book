import type { ApplicationSettings } from "@/lib/application-settings";

export type ChatModelProvider = "llama" | "google" | "anthropic" | "openai";

export interface ChatModelInfo {
	id: string;
	displayName: string;
	provider: ChatModelProvider;
	maxContextLength?: number;
	vision?: boolean;
	trainedForToolUse?: boolean;
}

export const GOOGLE_GEMINI_MODELS: readonly ChatModelInfo[] = [
	{
		id: "gemini-2.5-flash",
		displayName: "Gemini 2.5 Flash",
		provider: "google",
		vision: true,
		trainedForToolUse: true,
	},
	{
		id: "gemini-2.5-pro",
		displayName: "Gemini 2.5 Pro",
		provider: "google",
		vision: true,
		trainedForToolUse: true,
	},
] as const;

export const ANTHROPIC_CLAUDE_MODELS: readonly ChatModelInfo[] = [
	{
		id: "claude-sonnet-4-6",
		displayName: "Claude Sonnet 4.6",
		provider: "anthropic",
		vision: true,
		trainedForToolUse: true,
	},
	{
		id: "claude-haiku-4-5-20251001",
		displayName: "Claude Haiku 4.5",
		provider: "anthropic",
		vision: true,
		trainedForToolUse: true,
	},
	{
		id: "claude-opus-4-6",
		displayName: "Claude Opus 4.6",
		provider: "anthropic",
		vision: true,
		trainedForToolUse: true,
	},
] as const;

export function getConfiguredFrontierModels(
	settings: ApplicationSettings | null | undefined,
	options?: {
		openAiModels?: ChatModelInfo[];
	},
): ChatModelInfo[] {
	const models: ChatModelInfo[] = [];
	if (settings?.["chat.providers.google.apiKey"].trim()) {
		models.push(...GOOGLE_GEMINI_MODELS);
	}
	if (settings?.["chat.providers.anthropic.apiKey"].trim()) {
		models.push(...ANTHROPIC_CLAUDE_MODELS);
	}
	if (settings?.["chat.providers.openai.apiKey"].trim()) {
		models.push(...(options?.openAiModels ?? []));
	}
	return models;
}

export function getChatModelProviderLabel(provider: ChatModelProvider): string {
	switch (provider) {
		case "google":
			return "Google Gemini";
		case "anthropic":
			return "Anthropic Claude";
		case "openai":
			return "OpenAI";
		default:
			return "Local model";
	}
}

export function isLocalChatModel(
	model: ChatModelInfo | null | undefined,
): model is ChatModelInfo & { provider: "llama" } {
	return model?.provider === "llama";
}
