import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";

import { coerceString, createUnsupportedTool, textResult } from "./helpers";

export const taskStopTool: ChatToolDefinition = {
	name: "TaskStop",
	source: "claude",
	category: "workflow",
	uiKind: "text",
	description: "Stop a running background task by ID.",
	inputSchema: {
		type: "object",
		properties: {
			task_id: {
				type: "string",
				description: "ID of the background task to stop.",
			},
			shell_id: {
				type: "string",
				description: "Deprecated alias for task_id.",
			},
		},
		additionalProperties: false,
	},
	readOnly: false,
	concurrencySafe: true,
	async execute(input, context) {
		const taskId = coerceString(input.task_id) || coerceString(input.shell_id);
		if (!taskId) {
			throw new Error("Missing required parameter: task_id");
		}
		const result = await context.stopTask(taskId);
		return textResult(
			`Stopped task ${result.taskId}.`,
			{
				kind: "text",
				title: "Stopped",
				text: result.command
					? `Stopped task ${result.taskId}: ${result.command}`
					: `Stopped task ${result.taskId}.`,
			},
		);
	},
};

export const sendUserMessageTool: ChatToolDefinition = {
	name: "SendUserMessage",
	aliases: ["Brief"],
	source: "claude",
	category: "workflow",
	uiKind: "text",
	description: "Return a concise user-facing message without running another tool.",
	inputSchema: {
		type: "object",
		properties: {
			title: {
				type: "string",
				description: "Optional heading for the user-facing message.",
			},
			message: {
				type: "string",
				description: "User-facing message.",
			},
			status: {
				type: "string",
				description: "Optional status label such as info, warning, or success.",
			},
			attachments: {
				type: "array",
				description: "Optional attachment paths or identifiers.",
				items: { type: "string" },
			},
		},
		required: ["message"],
		additionalProperties: false,
	},
	readOnly: true,
	concurrencySafe: true,
	async execute(input) {
		const message = coerceString(input.message);
		const title = coerceString(input.title) || "Message";
		const status = coerceString(input.status);
		const attachments = Array.isArray(input.attachments)
			? input.attachments.filter((value): value is string => typeof value === "string")
			: [];
		return textResult(message, {
			kind: "text",
			title,
			text:
				[
					status ? `[${status}]` : undefined,
					message,
					attachments.length > 0 ? `Attachments: ${attachments.join(", ")}` : undefined,
				]
					.filter(Boolean)
					.join("\n"),
		});
	},
};

export const structuredOutputTool: ChatToolDefinition = {
	name: "StructuredOutput",
	source: "claude",
	category: "workflow",
	uiKind: "json",
	description: "Emit structured JSON back into the transcript.",
	inputSchema: {
		type: "object",
		description: "Arbitrary JSON object to emit.",
	},
	readOnly: true,
	concurrencySafe: true,
	async execute(input) {
		return {
			content: JSON.stringify(input, null, 2),
			display: {
				kind: "json",
				title: "Structured output",
				value: input,
			},
			structuredContent: input,
		};
	},
};

export const toolSearchTool: ChatToolDefinition = {
	name: "ToolSearch",
	source: "claude",
	category: "workflow",
	uiKind: "file_list",
	description: "Search the live tool registry by keyword, category, or parameter name.",
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Search query.",
			},
		},
		required: ["query"],
		additionalProperties: false,
	},
	readOnly: true,
	concurrencySafe: true,
	async execute(input, context) {
		const query = coerceString(input.query).toLowerCase();
		const matches = context
			.listTools()
			.filter((tool) =>
				[
					tool.name,
					...(tool.aliases ?? []),
					tool.category,
					tool.description,
					...Object.keys(tool.inputSchema.properties ?? {}),
				].some((value) => value.toLowerCase().includes(query)),
			)
			.map((tool) => ({
				value: tool.name,
				title: tool.name,
				description: tool.description,
				metadata: tool.category,
			}));
		return textResult(
			matches.map((tool) => `${tool.title}: ${tool.description}`).join("\n") || "No matching tools.",
			{
				kind: "file_list",
				title: query,
				items: matches,
				subtitle: `${matches.length} matching tools`,
			},
		);
	},
};

export const unsupportedWorkflowTools: ChatToolDefinition[] = [
	createUnsupportedTool({
		name: "AskUserQuestion",
		source: "claude",
		category: "planning",
		uiKind: "text",
		description: "Ask the user a structured multiple-choice question.",
		inputSchema: { type: "object", properties: {}, additionalProperties: true },
		readOnly: false,
		concurrencySafe: false,
		reason: "Structured question forms are not wired into this chat UI yet.",
	}),
	createUnsupportedTool({
		name: "Agent",
		aliases: ["Task"],
		source: "claude",
		category: "advanced",
		uiKind: "text",
		description: "Launch a subagent task.",
		inputSchema: { type: "object", properties: {}, additionalProperties: true },
		readOnly: false,
		concurrencySafe: false,
		reason: "Subagent orchestration is not wired into Prompt Book yet.",
	}),
	createUnsupportedTool({
		name: "Config",
		source: "claude",
		category: "workflow",
		uiKind: "json",
		description: "Read or update runtime configuration.",
		inputSchema: { type: "object", properties: {}, additionalProperties: true },
		readOnly: false,
		concurrencySafe: false,
		reason: "Runtime config editing is not available through the chat tool loop yet.",
	}),
	createUnsupportedTool({
		name: "EnterPlanMode",
		source: "claude",
		category: "planning",
		uiKind: "text",
		description: "Enter plan mode.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		readOnly: false,
		concurrencySafe: false,
		reason: "Plan mode switching is controlled by the app shell, not the local model loop.",
	}),
	createUnsupportedTool({
		name: "ExitPlanMode",
		source: "claude",
		category: "planning",
		uiKind: "text",
		description: "Exit plan mode.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		readOnly: false,
		concurrencySafe: false,
		reason: "Plan mode switching is controlled by the app shell, not the local model loop.",
	}),
	createUnsupportedTool({
		name: "EnterWorktree",
		source: "claude",
		category: "advanced",
		uiKind: "text",
		description: "Enter an isolated worktree.",
		inputSchema: { type: "object", properties: {}, additionalProperties: true },
		readOnly: false,
		concurrencySafe: false,
		reason: "Worktree orchestration is not available in Prompt Book yet.",
	}),
	createUnsupportedTool({
		name: "ExitWorktree",
		source: "claude",
		category: "advanced",
		uiKind: "text",
		description: "Exit an isolated worktree.",
		inputSchema: { type: "object", properties: {}, additionalProperties: true },
		readOnly: false,
		concurrencySafe: false,
		reason: "Worktree orchestration is not available in Prompt Book yet.",
	}),
	createUnsupportedTool({
		name: "RemoteTrigger",
		source: "claude",
		category: "workflow",
		uiKind: "text",
		description: "Trigger a remote agent workflow.",
		inputSchema: { type: "object", properties: {}, additionalProperties: true },
		readOnly: false,
		concurrencySafe: false,
		reason: "Remote triggers are not implemented in Prompt Book.",
	}),
	createUnsupportedTool({
		name: "SendMessage",
		source: "claude",
		category: "workflow",
		uiKind: "text",
		description: "Send a message to another agent.",
		inputSchema: { type: "object", properties: {}, additionalProperties: true },
		readOnly: false,
		concurrencySafe: false,
		reason: "Cross-agent messaging is not available in Prompt Book.",
	}),
	createUnsupportedTool({
		name: "Skill",
		source: "claude",
		category: "workflow",
		uiKind: "text",
		description: "Invoke a Cursor skill.",
		inputSchema: { type: "object", properties: {}, additionalProperties: true },
		readOnly: false,
		concurrencySafe: false,
		reason: "Cursor skill execution is not exposed to the local model loop.",
	}),
	createUnsupportedTool({
		name: "TaskOutput",
		source: "claude",
		category: "tasks",
		uiKind: "text",
		description: "Read task output from another workflow.",
		inputSchema: { type: "object", properties: {}, additionalProperties: true },
		readOnly: true,
		concurrencySafe: true,
		reason: "Background task output is not available in Prompt Book.",
	}),
];
