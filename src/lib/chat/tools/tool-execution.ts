import { findToolByName } from "./tool-registry";
import type { ChatToolCall, ChatToolContext, ChatToolResult } from "./tool-types";

export interface ExecutedToolCall {
	call: ChatToolCall;
	result: ChatToolResult;
}

export async function executeToolCall(
	call: ChatToolCall,
	context: ChatToolContext,
): Promise<ExecutedToolCall> {
	const tool = findToolByName(call.name);
	if (!tool) {
		return {
			call,
			result: {
				content: `Unknown tool: ${call.name}`,
				isError: true,
				display: {
					kind: "text",
					title: call.name,
					text: `Unknown tool: ${call.name}`,
				},
			},
		};
	}

	try {
		const result = await tool.execute(call.input, context);
		return { call, result };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			call,
			result: {
				content: message,
				isError: true,
				display: {
					kind: "text",
					title: call.name,
					text: message,
				},
			},
		};
	}
}
