import type { ChatApiMessage, ChatTranscriptEntry } from "./types";

function toApiMessage(entry: ChatTranscriptEntry): ChatApiMessage | null {
	if (entry.subtype === "tool_use" && entry.toolInvocation) {
		return {
			role: "assistant",
			content: entry.content.trim()
				? [{ type: "text", text: entry.content.trim() }]
				: null,
			tool_calls: [
				{
					id: entry.toolInvocation.toolCallId,
					type: "function",
					function: {
						name: entry.toolInvocation.toolName,
						arguments: JSON.stringify(entry.toolInvocation.input),
					},
				},
			],
		};
	}

	if (entry.subtype === "tool_result" && entry.toolResult) {
		return {
			role: "tool",
			content: [{ type: "text", text: entry.toolResult.outputText }],
			tool_call_id: entry.toolResult.toolCallId,
			name: entry.toolResult.toolName,
		};
	}

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

function mergeMessages(left: ChatApiMessage, right: ChatApiMessage): ChatApiMessage {
	return {
		role: left.role,
		content:
			left.content && right.content
				? [...left.content, { type: "text", text: "\n\n" }, ...right.content]
				: left.content ?? right.content,
	};
}

export function normalizeMessagesForAnthropic(
	transcript: ChatTranscriptEntry[],
): ChatApiMessage[] {
	const result: ChatApiMessage[] = [];

	for (const entry of transcript) {
		if (entry.visibility !== "visible") continue;
		if (entry.isStreaming) continue;
		if (!entry.includeInHistory) continue;

		const normalized = toApiMessage(entry);
		if (!normalized) continue;

		const previous = result.at(-1);
		if (
			previous &&
			previous.role === normalized.role &&
			!previous.tool_calls &&
			!normalized.tool_calls &&
			previous.role !== "tool"
		) {
			result[result.length - 1] = mergeMessages(previous, normalized);
			continue;
		}

		result.push(normalized);
	}

	return result;
}
