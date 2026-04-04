const ALT_THINK_OPEN_TAG_PATTERN = /<(thinking|reasoning)>/gi;
const ALT_THINK_CLOSE_TAG_PATTERN = /<\/(thinking|reasoning)>/gi;
const THINK_BLOCK_PATTERN = /<(?:think|thinking|reasoning)>[\s\S]*?<\/(?:think|thinking|reasoning)>/gi;

type ChatTextBlock = {
	type?: string;
	text?: string;
	content?: unknown;
	summary?: unknown;
};

function isReasoningLikeType(type: unknown): boolean {
	if (typeof type !== "string") {
		return false;
	}
	const lower = type.trim().toLowerCase();
	return lower === "summary_text" || lower.includes("reason") || lower.includes("think");
}

function collectReasoningFragments(value: unknown, fragments: string[]): void {
	if (typeof value === "string") {
		fragments.push(value);
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectReasoningFragments(item, fragments);
		}
		return;
	}

	if (!value || typeof value !== "object") {
		return;
	}

	const record = value as Record<string, unknown>;
	if (typeof record.text === "string") {
		fragments.push(record.text);
	}
	if ("summary" in record) {
		collectReasoningFragments(record.summary, fragments);
	}
	if ("content" in record) {
		collectReasoningBlocks(record.content, fragments);
	}
}

function collectReasoningBlocks(value: unknown, fragments: string[]): void {
	if (!Array.isArray(value)) {
		return;
	}

	for (const item of value) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const block = item as ChatTextBlock;
		if (!isReasoningLikeType(block.type)) {
			continue;
		}
		collectReasoningFragments(block, fragments);
	}
}

export function canonicalizeThinkingTags(text: string): string {
	return text
		.replace(ALT_THINK_OPEN_TAG_PATTERN, "<think>")
		.replace(ALT_THINK_CLOSE_TAG_PATTERN, "</think>");
}

export function stripThinkingBlocks(text: string): string {
	return canonicalizeThinkingTags(text).replace(THINK_BLOCK_PATTERN, "");
}

export function extractVisibleTextContent(
	content: string | Array<{ type?: string; text?: string }> | undefined | null,
): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.map((block) => {
			if (isReasoningLikeType(block?.type)) {
				return "";
			}
			return typeof block?.text === "string" ? block.text : "";
		})
		.join("");
}

export function extractReasoningText(source: unknown): string {
	if (!source || typeof source !== "object") {
		return "";
	}

	const record = source as Record<string, unknown>;
	const fragments: string[] = [];

	collectReasoningFragments(record.reasoning_content, fragments);
	collectReasoningFragments(record.reasoning, fragments);
	collectReasoningFragments(record.reasoning_text, fragments);
	collectReasoningFragments(record.thinking, fragments);
	collectReasoningBlocks(record.content, fragments);

	return fragments.join("");
}
