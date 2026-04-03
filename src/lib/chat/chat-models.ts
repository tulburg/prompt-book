import type { ApplicationSettings } from "@/lib/application-settings";

export type ChatModelProvider = "llama" | "google";

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

export function getConfiguredFrontierModels(
	settings: ApplicationSettings | null | undefined,
): ChatModelInfo[] {
	if (!settings?.["chat.providers.google.apiKey"].trim()) {
		return [];
	}
	return [...GOOGLE_GEMINI_MODELS];
}

export function getChatModelProviderLabel(provider: ChatModelProvider): string {
	return provider === "google" ? "Google Gemini" : "Local model";
}

export function isLocalChatModel(
	model: ChatModelInfo | null | undefined,
): model is ChatModelInfo & { provider: "llama" } {
	return model?.provider === "llama";
}
