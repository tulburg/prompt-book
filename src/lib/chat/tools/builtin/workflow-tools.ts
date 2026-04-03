import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";

import { coerceString, createUnsupportedTool, textResult } from "./helpers";

type QuestionOption = {
	id: string;
	label: string;
};

type QuestionDisplayItem = {
	id: string;
	prompt: string;
	details?: string;
	responseType: "text" | "single_select" | "multi_select";
	options?: QuestionOption[];
};

function toQuestionOption(value: unknown, index: number): QuestionOption | null {
	if (typeof value === "string" && value.trim()) {
		return {
			id: `option-${index + 1}`,
			label: value.trim(),
		};
	}
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	const label =
		coerceString(record.label) ||
		coerceString(record.title) ||
		coerceString(record.value);
	if (!label) {
		return null;
	}
	return {
		id: coerceString(record.id, `option-${index + 1}`),
		label,
	};
}

function normalizeQuestion(value: unknown, index: number): QuestionDisplayItem | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const record = value as Record<string, unknown>;
	const prompt =
		coerceString(record.prompt) ||
		coerceString(record.message) ||
		coerceString(record.title);
	if (!prompt) {
		return null;
	}
	const rawOptions = Array.isArray(record.options) ? record.options : [];
	const options = rawOptions
		.map((option, optionIndex) => toQuestionOption(option, optionIndex))
		.filter((option): option is QuestionOption => Boolean(option));
	const declaredResponseType = coerceString(record.response_type).toLowerCase();
	const allowMultiple = record.allow_multiple === true || record.allowMultiple === true;
	let responseType: QuestionDisplayItem["responseType"] = "text";
	if (declaredResponseType === "multi_select" || allowMultiple) {
		responseType = "multi_select";
	} else if (declaredResponseType === "single_select" || options.length > 0) {
		responseType = "single_select";
	}
	return {
		id: coerceString(record.id, `question-${index + 1}`),
		prompt,
		details: coerceString(record.details) || undefined,
		responseType,
		options: options.length > 0 ? options : undefined,
	};
}

function normalizeQuestionDisplayInput(input: Record<string, unknown>) {
	const questionsSource = Array.isArray(input.questions)
		? input.questions
		: input.question
			? [input.question]
			: input.prompt || input.message || input.title
				? [
						{
							id: "question-1",
							prompt:
								coerceString(input.prompt) ||
								coerceString(input.message) ||
								coerceString(input.title),
							options: input.options,
							allow_multiple: input.allow_multiple,
							allowMultiple: input.allowMultiple,
							response_type: input.response_type,
						},
					]
				: [];
	const questions = questionsSource
		.map((question, index) => normalizeQuestion(question, index))
		.filter((question): question is QuestionDisplayItem => Boolean(question));
	if (questions.length === 0) {
		throw new Error("AskUserQuestion requires at least one valid question.");
	}
	return {
		title: coerceString(input.title) || "Question",
		description: coerceString(input.description) || undefined,
		submitLabel: coerceString(input.submit_label || input.submitLabel) || undefined,
		helpText:
			coerceString(input.help_text || input.helpText) ||
			"Answer in your next message to continue.",
		questions,
	};
}

function summarizeQuestions(
	title: string,
	questions: QuestionDisplayItem[],
	description?: string,
) {
	return [
		title,
		description,
		...questions.map((question) => {
			const optionText =
				question.options && question.options.length > 0
					? ` Options: ${question.options.map((option) => option.label).join(", ")}.`
					: "";
			return `- ${question.prompt}${optionText}`;
		}),
		"Answer in your next message to continue.",
	]
		.filter(Boolean)
		.join("\n");
}

function buildTaskMetadata(
	input: Record<string, unknown>,
): Array<{ label: string; value: string }> {
	return [
		{ label: "Type", value: coerceString(input.subagent_type || input.type) },
		{ label: "Model", value: coerceString(input.model) },
		{ label: "Task ID", value: coerceString(input.task_id || input.agent_id) },
		{
			label: "Mode",
			value:
				input.readonly === true
					? "Read only"
					: input.run_in_background === true
						? "Background"
						: "",
		},
	].filter((item) => item.value);
}

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

export const askUserQuestionTool: ChatToolDefinition = {
	name: "AskUserQuestion",
	source: "claude",
	category: "planning",
	uiKind: "question",
	description: "Ask the user a structured question and wait for their next reply.",
	inputSchema: {
		type: "object",
		properties: {
			title: { type: "string", description: "Optional heading for the question card." },
			description: { type: "string", description: "Optional supporting text." },
			help_text: { type: "string", description: "Optional guidance shown beneath the question." },
			submit_label: { type: "string", description: "Optional submit label." },
			questions: {
				type: "array",
				description: "One or more questions to present to the user.",
				items: {
					type: "object",
					properties: {
						id: { type: "string" },
						prompt: { type: "string" },
						details: { type: "string" },
						response_type: {
							type: "string",
							enum: ["text", "single_select", "multi_select"],
						},
						allow_multiple: { type: "boolean" },
						options: {
							type: "array",
							items: {
								type: "object",
								properties: {
									id: { type: "string" },
									label: { type: "string" },
								},
							},
						},
					},
				},
			},
		},
		additionalProperties: true,
	},
	readOnly: false,
	concurrencySafe: false,
	async execute(input) {
		const normalized = normalizeQuestionDisplayInput(input);
		return {
			content: summarizeQuestions(
				normalized.title,
				normalized.questions,
				normalized.description,
			),
			display: {
				kind: "question",
				title: normalized.title,
				description: normalized.description,
				submitLabel: normalized.submitLabel,
				helpText: normalized.helpText,
				questions: normalized.questions,
			},
			structuredContent: {
				title: normalized.title,
				questions: normalized.questions.map((question) => ({
					id: question.id,
					prompt: question.prompt,
					responseType: question.responseType,
					options:
						question.options?.map((option) => ({
							id: option.id,
							label: option.label,
						})) ?? [],
				})),
			},
			pauseAfter: true,
		};
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

export const agentTool: ChatToolDefinition = {
	name: "Agent",
	aliases: ["Task"],
	source: "claude",
	category: "advanced",
	uiKind: "task",
	description: "Request a delegated subagent task.",
	inputSchema: {
		type: "object",
		properties: {
			description: { type: "string", description: "Short description of the delegated task." },
			prompt: { type: "string", description: "Detailed task prompt for the delegated agent." },
			agent_name: { type: "string", description: "Optional agent or role name." },
			subagent_type: { type: "string", description: "Optional subagent category." },
			model: { type: "string", description: "Optional model hint." },
			readonly: { type: "boolean", description: "Whether the delegated agent should be read-only." },
			run_in_background: { type: "boolean", description: "Whether the delegated agent should run in the background." },
		},
		additionalProperties: true,
	},
	readOnly: false,
	concurrencySafe: false,
	async execute(input) {
		const description =
			coerceString(input.description) ||
			coerceString(input.prompt).split("\n")[0] ||
			"Delegated task";
		const agentName =
			coerceString(input.agent_name) || coerceString(input.agentName) || undefined;
		const metadata = buildTaskMetadata(input);
		const message =
			"Subagent orchestration is not available in the local Prompt Book runtime yet.";
		return {
			content: `${message}\nRequested task: ${description}`,
			isError: true,
			display: {
				kind: "task",
				title: "Subagent request",
				status: "blocked",
				summary: description,
				agentName,
				prompt: coerceString(input.prompt) || undefined,
				result: message,
				metadata,
			},
		};
	},
};

export const taskOutputTool: ChatToolDefinition = {
	name: "TaskOutput",
	source: "claude",
	category: "tasks",
	uiKind: "task",
	description: "Read output from a delegated task.",
	inputSchema: {
		type: "object",
		properties: {
			task_id: { type: "string", description: "Delegated task identifier." },
			agent_id: { type: "string", description: "Alias for task_id." },
		},
		additionalProperties: true,
	},
	readOnly: true,
	concurrencySafe: true,
	async execute(input) {
		const taskId = coerceString(input.task_id) || coerceString(input.agent_id);
		const message =
			"Delegated task output is not persisted in the local Prompt Book runtime yet.";
		return {
			content: taskId ? `${message}\nTask ID: ${taskId}` : message,
			isError: true,
			display: {
				kind: "task",
				title: "Task output",
				status: "blocked",
				summary: taskId ? `Unable to load output for ${taskId}` : "Task output unavailable",
				result: message,
				metadata: taskId ? [{ label: "Task ID", value: taskId }] : undefined,
			},
		};
	},
};

export const unsupportedWorkflowTools: ChatToolDefinition[] = [
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
];
