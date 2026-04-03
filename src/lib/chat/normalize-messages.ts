import type { ChatApiMessage, ChatToolResultRecord, ChatTranscriptEntry } from "./types";

type NormalizeOptions = {
	toolResultMode?: "tool" | "user";
};

type NormalizedMessage = {
	message: ChatApiMessage;
	canMergeWithPrevious: boolean;
};

function serializeToolResult(record: ChatToolResultRecord): string {
	const content = [{ type: "text", text: record.outputText }];
	return JSON.stringify({
		ok: !record.isError,
		error: record.isError ? record.outputText : null,
		content,
		structuredContent: record.structuredContent ?? null,
	});
}

function formatUserToolResultMessage(record: ChatToolResultRecord): string {
	const status = record.isError ? "error" : "success";
	return `Tool result (${status}) for ${record.toolCallId}:\n${serializeToolResult(record)}`;
}

function toApiMessage(
	entry: ChatTranscriptEntry,
	options: NormalizeOptions,
): NormalizedMessage | null {
	if (entry.subtype === "tool_use" && entry.toolInvocation) {
		return {
			message: {
				role: "assistant",
				content: null,
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
			},
			canMergeWithPrevious: false,
		};
	}

	if (entry.subtype === "tool_result" && entry.toolResult) {
		if (options.toolResultMode === "user") {
			return {
				message: {
					role: "user",
					content: [{ type: "text", text: formatUserToolResultMessage(entry.toolResult) }],
					tool_call_id: entry.toolResult.toolCallId,
					name: entry.toolResult.toolName,
				},
				canMergeWithPrevious: false,
			};
		}

		return {
			message: {
				role: "tool",
				content: [{ type: "text", text: serializeToolResult(entry.toolResult) }],
				tool_call_id: entry.toolResult.toolCallId,
				name: entry.toolResult.toolName,
			},
			canMergeWithPrevious: false,
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
		message: {
			role: entry.role,
			content: [{ type: "text", text }],
		},
		canMergeWithPrevious: true,
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
	options: NormalizeOptions = {},
): ChatApiMessage[] {
	const result: ChatApiMessage[] = [];
	let previousCanMerge = false;

	for (const entry of transcript) {
		if (entry.visibility !== "visible") continue;
		if (entry.isStreaming) continue;
		if (!entry.includeInHistory) continue;

		const normalized = toApiMessage(entry, options);
		if (!normalized) continue;

		const previous = result.at(-1);
		if (
			previous &&
			previousCanMerge &&
			normalized.canMergeWithPrevious &&
			previous.role === normalized.message.role &&
			!previous.tool_calls &&
			!normalized.message.tool_calls &&
			!previous.tool_call_id &&
			!normalized.message.tool_call_id &&
			previous.role !== "tool"
		) {
			result[result.length - 1] = mergeMessages(previous, normalized.message);
			previousCanMerge = true;
			continue;
		}

		result.push(normalized.message);
		previousCanMerge = normalized.canMergeWithPrevious;
	}

	return result;
}
