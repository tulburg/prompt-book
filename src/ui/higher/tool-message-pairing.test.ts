import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/lib/chat/types";
import { buildToolMessagePairingIndex } from "@/ui/higher/tool-message-pairing";

describe("tool message pairing", () => {
	it("pairs tool messages even when assistant text appears between them", () => {
		const toolUse: ChatMessage = {
			id: "tool-use",
			role: "assistant",
			content: 'Bash({"command":"pwd"})',
			timestamp: 1,
			subtype: "tool_use",
			toolInvocation: {
				toolCallId: "call-1",
				toolName: "Bash",
				input: { command: "pwd" },
			},
		};
		const assistantText: ChatMessage = {
			id: "assistant-text",
			role: "assistant",
			content: "Let me check that for you.",
			timestamp: 2,
			subtype: "message",
		};
		const toolResult: ChatMessage = {
			id: "tool-result",
			role: "tool",
			content: "/Users/tulburg/Developer/prompt-book",
			timestamp: 3,
			subtype: "tool_result",
			toolResult: {
				toolCallId: "call-1",
				toolName: "Bash",
				input: { command: "pwd" },
				outputText: "/Users/tulburg/Developer/prompt-book",
			},
		};

		const index = buildToolMessagePairingIndex([
			toolUse,
			assistantText,
			toolResult,
		]);

		expect(index.pairedResultIds.has(toolResult.id)).toBe(true);
		expect(index.pairedResultByToolUseId.get(toolUse.id)).toBe(toolResult);
	});
});
