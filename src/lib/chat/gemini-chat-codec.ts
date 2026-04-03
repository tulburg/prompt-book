import type { AnthropicRequest } from "./types";

export interface GeminiPart {
	text?: string;
}

export interface GeminiContent {
	role: "user" | "model";
	parts: GeminiPart[];
}

export interface GeminiGenerateContentRequest {
	systemInstruction?: {
		parts: GeminiPart[];
	};
	contents: GeminiContent[];
	generationConfig: {
		temperature: number;
	};
}

function flattenBlocks(
	content: string | Array<{ type?: string; text?: string }> | undefined | null,
): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((block) => (typeof block?.text === "string" ? block.text : ""))
			.join("");
	}
	return "";
}

function mergeConsecutiveSameRole(contents: GeminiContent[]): GeminiContent[] {
	const merged: GeminiContent[] = [];
	for (const content of contents) {
		const previous = merged.at(-1);
		if (previous && previous.role === content.role) {
			previous.parts.push({ text: "\n\n" }, ...content.parts);
			continue;
		}
		merged.push({
			role: content.role,
			parts: [...content.parts],
		});
	}
	return merged;
}

export function toGeminiContents(request: AnthropicRequest): GeminiContent[] {
	const contents = request.messages
		.map((message) => {
			const text = flattenBlocks(message.content).trim();
			if (!text) {
				return null;
			}
			return {
				role: message.role === "assistant" ? ("model" as const) : ("user" as const),
				parts: [{ text }],
			};
		})
		.filter((content): content is GeminiContent => content !== null);

	return mergeConsecutiveSameRole(contents);
}

export function buildGeminiGenerateContentRequest(
	request: AnthropicRequest,
): GeminiGenerateContentRequest {
	const systemText = request.system
		.map((section) => section.trim())
		.filter(Boolean)
		.join("\n\n");

	return {
		systemInstruction: systemText
			? {
					parts: [{ text: systemText }],
				}
			: undefined,
		contents: toGeminiContents(request),
		generationConfig: {
			temperature: 0.7,
		},
	};
}
