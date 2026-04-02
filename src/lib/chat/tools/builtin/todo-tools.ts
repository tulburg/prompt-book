import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";

import { coerceBoolean, coerceString, textResult } from "./helpers";

type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

const VALID_STATUSES: TodoStatus[] = ["pending", "in_progress", "completed", "cancelled"];

function normalizeTodoItems(input: unknown): Array<{
	id: string;
	content: string;
	status: TodoStatus;
}> {
	if (!Array.isArray(input)) return [];
	return input
		.map((item) => {
			if (!item || typeof item !== "object") return null;
			const record = item as Record<string, unknown>;
			const id = coerceString(record.id);
			const content = coerceString(record.content);
			const status = coerceString(record.status) as TodoStatus;
			if (!id || !content) return null;
			if (!VALID_STATUSES.includes(status)) return null;
			return { id, content, status };
		})
		.filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function mergeTodoPatch(
	current: Array<{ id: string; content: string; status: TodoStatus }>,
	input: unknown,
) {
	if (!input || typeof input !== "object") return [];
	const record = input as Record<string, unknown>;
	const id = coerceString(record.id);
	if (!id) return [];
	const existing = current.find((item) => item.id === id);
	const content = coerceString(record.content, existing?.content ?? "");
	const status = coerceString(record.status, existing?.status ?? "") as TodoStatus;
	if (!content || !VALID_STATUSES.includes(status)) return [];
	return [{ id, content, status }];
}

function todoListResult(
	title: string,
	items: Array<{ id: string; content: string; status: TodoStatus }>,
) {
	return textResult(
		items.map((item) => `${item.status}: ${item.content}`).join("\n") || "No tasks.",
		{ kind: "todo_list", title, items },
	);
}

export const todoWriteTool: ChatToolDefinition = {
	name: "TodoWrite",
	source: "claude",
	category: "tasks",
	uiKind: "todo_list",
	description: [
		"Create or update the session todo list for tracking complex tasks.",
		"Use for multi-step tasks (3+ steps) to track progress.",
		"Keep only one task in_progress at a time.",
	].join(" "),
	inputSchema: {
		type: "object",
		properties: {
			merge: {
				type: "boolean",
				description: "When true, merge with existing todos by id. When false, replace the entire list.",
			},
			todos: {
				type: "array",
				description: "Todo items to write.",
				items: {
					type: "object",
					properties: {
						id: { type: "string" },
						content: { type: "string" },
						status: {
							type: "string",
							enum: ["pending", "in_progress", "completed", "cancelled"],
						},
					},
					required: ["id", "content", "status"],
				},
			},
			items: {
				type: "array",
				description: "Alias for todos.",
				items: {
					type: "object",
					properties: {
						id: { type: "string" },
						content: { type: "string" },
						status: {
							type: "string",
							enum: ["pending", "in_progress", "completed", "cancelled"],
						},
					},
					required: ["id", "content", "status"],
				},
			},
		},
		required: [],
		additionalProperties: false,
	},
	readOnly: false,
	concurrencySafe: false,
	summarize() {
		return "Update todo list";
	},
	async execute(input, context) {
		const items = normalizeTodoItems(input.items ?? input.todos);
		const merge = coerceBoolean(input.merge, true);
		let next = context.setTodos(items, merge);

		// Auto-clear: if all items are completed, clear the list
		if (next.length > 0 && next.every((item) => item.status === "completed")) {
			next = context.setTodos([], false);
		}

		return todoListResult("Todo list", next);
	},
};

export const taskCreateTool: ChatToolDefinition = {
	name: "TaskCreate",
	source: "claude",
	category: "tasks",
	uiKind: "todo_list",
	description: "Create a single task entry.",
	inputSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "Task id." },
			content: { type: "string", description: "Task description." },
			status: {
				type: "string",
				enum: ["pending", "in_progress", "completed", "cancelled"],
				description: "Task status. Defaults to pending.",
			},
		},
		required: ["id", "content"],
		additionalProperties: false,
	},
	readOnly: false,
	concurrencySafe: false,
	async execute(input, context) {
		const next = context.setTodos(
			normalizeTodoItems([{ ...input, status: coerceString(input.status, "pending") }]),
			true,
		);
		return todoListResult("Created task", next);
	},
};

export const taskGetTool: ChatToolDefinition = {
	name: "TaskGet",
	source: "claude",
	category: "tasks",
	uiKind: "todo_list",
	description: "Get a single task by id.",
	inputSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "Task id." },
		},
		required: ["id"],
		additionalProperties: false,
	},
	readOnly: true,
	concurrencySafe: true,
	async execute(input, context) {
		const id = coerceString(input.id);
		const match = context.getTodos().filter((item) => item.id === id);
		return todoListResult(`Task ${id}`, match);
	},
};

export const taskListTool: ChatToolDefinition = {
	name: "TaskList",
	source: "claude",
	category: "tasks",
	uiKind: "todo_list",
	description: "List all current tasks.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
	readOnly: true,
	concurrencySafe: true,
	async execute(_input, context) {
		return todoListResult("Tasks", context.getTodos());
	},
};

export const taskUpdateTool: ChatToolDefinition = {
	name: "TaskUpdate",
	source: "claude",
	category: "tasks",
	uiKind: "todo_list",
	description: "Update an existing task entry.",
	inputSchema: {
		type: "object",
		properties: {
			id: { type: "string", description: "Task id." },
			content: { type: "string", description: "Task description." },
			status: {
				type: "string",
				enum: ["pending", "in_progress", "completed", "cancelled"],
				description: "Task status.",
			},
		},
		required: ["id"],
		additionalProperties: false,
	},
	readOnly: false,
	concurrencySafe: false,
	async execute(input, context) {
		const next = context.setTodos(mergeTodoPatch(context.getTodos(), input), true);
		return todoListResult("Updated task", next);
	},
};
