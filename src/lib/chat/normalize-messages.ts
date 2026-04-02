import type { AnthropicMessage, ChatTranscriptEntry } from "./types";

function toAnthropicMessage(entry: ChatTranscriptEntry): AnthropicMessage | null {
	if (entry.role !== "user" && entry.role !== "assistant") {
		return null;
	}

	const text = entry.content.trim();
	if (!text) {
		return null;
	}

	return {
		role: entry.role,
		content: [{ type: "text", text }],
	};
}

function mergeMessages(left: AnthropicMessage, right: AnthropicMessage): AnthropicMessage {
	return {
		role: left.role,
		content: [...left.content, { type: "text", text: "\n\n" }, ...right.content],
	};
}

export function normalizeMessagesForAnthropic(
	transcript: ChatTranscriptEntry[],
): AnthropicMessage[] {
	const result: AnthropicMessage[] = [];

	for (const entry of transcript) {
		if (entry.visibility !== "visible") continue;
		if (entry.isStreaming) continue;
		if (!entry.includeInHistory) continue;

		const normalized = toAnthropicMessage(entry);
		if (!normalized) continue;

		const previous = result.at(-1);
		if (previous && previous.role === normalized.role) {
			result[result.length - 1] = mergeMessages(previous, normalized);
			continue;
		}

		result.push(normalized);
	}

	return result;
}
