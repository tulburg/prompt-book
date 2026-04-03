import type { ChatModelInfo } from "./chat-models";

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";

type OpenAiModelsResponse = {
	data?: Array<{
		id?: string;
	}>;
};

export async function fetchOpenAiModels(
	apiKey: string,
	options?: { signal?: AbortSignal },
): Promise<ChatModelInfo[]> {
	const trimmedKey = apiKey.trim();
	if (!trimmedKey) {
		return [];
	}

	const response = await fetch(OPENAI_MODELS_URL, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${trimmedKey}`,
		},
		signal: options?.signal,
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(
			errorText
				? `OpenAI model discovery failed with status ${response.status}: ${errorText}`
				: `OpenAI model discovery failed with status ${response.status}.`,
		);
	}

	const payload = (await response.json()) as OpenAiModelsResponse;
	return (payload.data ?? [])
		.map((item) => item.id?.trim() ?? "")
		.filter(isSupportedOpenAiChatModelId)
		.sort(compareOpenAiModelIds)
		.map((id) => ({
			id,
			displayName: formatOpenAiModelDisplayName(id),
			provider: "openai" as const,
			vision: !/nano/i.test(id),
			trainedForToolUse: true,
		}));
}

export function isSupportedOpenAiChatModelId(modelId: string): boolean {
	const normalized = modelId.trim().toLowerCase();
	if (!normalized) {
		return false;
	}

	if (
		/(?:^|[-_])(embedding|image|audio|transcribe|tts|moderation|whisper|realtime)(?:[-_]|$)/i.test(
			normalized,
		)
	) {
		return false;
	}

	return (
		normalized.startsWith("gpt-") ||
		normalized.startsWith("chatgpt-") ||
		/^o[134]\b/.test(normalized)
	);
}

function compareOpenAiModelIds(left: string, right: string): number {
	return rankOpenAiModelId(left) - rankOpenAiModelId(right) || left.localeCompare(right);
}

function rankOpenAiModelId(modelId: string): number {
	const normalized = modelId.toLowerCase();
	if (normalized.startsWith("gpt-5")) return 0;
	if (normalized.startsWith("gpt-4")) return 1;
	if (/^o[134]/.test(normalized)) return 2;
	if (normalized.startsWith("chatgpt-")) return 3;
	return 4;
}

function formatOpenAiModelDisplayName(modelId: string): string {
	const parts = modelId.split("-");
	if (parts[0]?.toLowerCase() === "gpt" && parts[1]) {
		const suffix = parts
			.slice(2)
			.map((part) =>
				part.toLowerCase() === "mini" || part.toLowerCase() === "nano"
					? part.charAt(0).toUpperCase() + part.slice(1)
					: part.toUpperCase(),
			)
			.join(" ");
		return suffix ? `GPT-${parts[1]} ${suffix}` : `GPT-${parts[1]}`;
	}

	return parts
		.map((part) => {
			if (part.toLowerCase() === "chatgpt") {
				return "ChatGPT";
			}
			return /^[a-z]\d$/i.test(part)
				? part.toUpperCase()
				: part.charAt(0).toUpperCase() + part.slice(1);
		})
		.join(" ");
}
