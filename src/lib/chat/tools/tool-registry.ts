import { CANONICAL_TOOL_INVENTORY } from "./canonical-inventory";
import { unsupportedAdvancedTools } from "./builtin/advanced-tools";
import { bashTool } from "./builtin/bash-tool";
import { editTool } from "./builtin/edit-tool";
import { globTool } from "./builtin/glob-tool";
import { grepTool } from "./builtin/grep-tool";
import { notebookEditTool } from "./builtin/notebook-edit-tool";
import { readTool } from "./builtin/read-tool";
import {
	taskCreateTool,
	taskGetTool,
	taskListTool,
	taskUpdateTool,
	todoWriteTool,
} from "./builtin/todo-tools";
import { webFetchTool } from "./builtin/web-fetch-tool";
import { webSearchTool } from "./builtin/web-search-tool";
import { writeTool } from "./builtin/write-tool";
import {
	sendUserMessageTool,
	structuredOutputTool,
	taskStopTool,
	toolSearchTool,
	unsupportedWorkflowTools,
} from "./builtin/workflow-tools";
import type { ChatToolContext, ChatToolDefinition, NativeToolDefinition } from "./tool-types";

const ALL_TOOLS: ChatToolDefinition[] = [
	readTool,
	writeTool,
	editTool,
	notebookEditTool,
	globTool,
	grepTool,
	bashTool,
	webFetchTool,
	webSearchTool,
	todoWriteTool,
	taskCreateTool,
	taskGetTool,
	taskListTool,
	taskUpdateTool,
	taskStopTool,
	sendUserMessageTool,
	structuredOutputTool,
	toolSearchTool,
	...unsupportedWorkflowTools,
	...unsupportedAdvancedTools,
];

export function getAllChatTools(): ChatToolDefinition[] {
	const deduped = new Map<string, ChatToolDefinition>();
	for (const tool of ALL_TOOLS) {
		if (!deduped.has(tool.name)) {
			deduped.set(tool.name, tool);
		}
	}
	return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function findToolByName(name: string): ChatToolDefinition | undefined {
	const normalized = name.trim().toLowerCase();
	return getAllChatTools().find(
		(tool) =>
			tool.name.toLowerCase() === normalized ||
			tool.aliases?.some((alias) => alias.toLowerCase() === normalized),
	);
}

export function getAvailableChatTools(context: ChatToolContext): ChatToolDefinition[] {
	return getAllChatTools().filter((tool) => tool.availability?.(context)?.supported !== false);
}

export function getNativeToolDefinitions(context: ChatToolContext): NativeToolDefinition[] {
	return getAvailableChatTools(context).map((tool) => ({
		type: "function",
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema,
		},
	}));
}

export function getCanonicalToolInventory() {
	return CANONICAL_TOOL_INVENTORY;
}
