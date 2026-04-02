import type { ChatMessage } from "@/lib/chat/types";

export interface ToolMessagePairingIndex {
	pairedResultIds: Set<string>;
	pairedResultByToolUseId: Map<string, ChatMessage>;
}

export function buildToolMessagePairingIndex(
	messages: ChatMessage[],
): ToolMessagePairingIndex {
	const toolUsesByCallId = new Map<string, ChatMessage>();
	const toolResultsByCallId = new Map<string, ChatMessage>();

	for (const message of messages) {
		if (message.subtype === "tool_use" && message.toolInvocation?.toolCallId) {
			toolUsesByCallId.set(message.toolInvocation.toolCallId, message);
		}
		if (message.subtype === "tool_result" && message.toolResult?.toolCallId) {
			toolResultsByCallId.set(message.toolResult.toolCallId, message);
		}
	}

	const pairedResultIds = new Set<string>();
	const pairedResultByToolUseId = new Map<string, ChatMessage>();

	for (const [toolCallId, toolUseMessage] of toolUsesByCallId) {
		const toolResultMessage = toolResultsByCallId.get(toolCallId);
		if (!toolResultMessage) continue;
		pairedResultIds.add(toolResultMessage.id);
		pairedResultByToolUseId.set(toolUseMessage.id, toolResultMessage);
	}

	return {
		pairedResultIds,
		pairedResultByToolUseId,
	};
}
