export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
	[key: string]: JsonValue;
}

export interface ChatToolJsonSchema {
	type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
	description?: string;
	enum?: string[];
	properties?: Record<string, ChatToolJsonSchema>;
	required?: string[];
	items?: ChatToolJsonSchema;
	additionalProperties?: boolean;
}

export type ChatToolSource = "claude" | "codally";

export type ChatToolCategory =
	| "filesystem"
	| "shell"
	| "search"
	| "web"
	| "planning"
	| "tasks"
	| "workflow"
	| "mcp"
	| "advanced";

export type ChatToolUiKind =
	| "text"
	| "input_output"
	| "file_list"
	| "command"
	| "todo_list"
	| "json"
	| "diff";

export interface ChatToolAvailability {
	supported: boolean;
	reason?: string;
}

export interface ChatToolDisplayText {
	kind: "text";
	title?: string;
	text: string;
}

export interface ChatToolDisplayInputOutput {
	kind: "input_output";
	title?: string;
	subtitle?: string;
	input: string;
	output?: string;
	isError?: boolean;
}

export interface ChatToolDisplayFileList {
	kind: "file_list";
	title?: string;
	subtitle?: string;
	items: Array<
		| string
		| {
				value: string;
				title?: string;
				description?: string;
				metadata?: string;
		  }
	>;
	truncated?: boolean;
}

export interface ChatToolDisplayCommand {
	kind: "command";
	title?: string;
	command: string;
	cwd?: string;
	stdout?: string;
	stderr?: string;
	exitCode?: number | null;
	status?: "completed" | "running";
	backgroundTaskId?: string;
	outputPath?: string;
}

export interface ChatToolDisplayTodoList {
	kind: "todo_list";
	title?: string;
	items: Array<{
		id: string;
		content: string;
		status: "pending" | "in_progress" | "completed" | "cancelled";
	}>;
}

export interface ChatToolDisplayJson {
	kind: "json";
	title?: string;
	value: JsonValue;
}

export interface DiffHunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: string[];
}

export interface ChatToolDisplayDiff {
	kind: "diff";
	filePath: string;
	action: "created" | "edited" | "overwritten";
	hunks: DiffHunk[];
	additions: number;
	deletions: number;
	originalContent?: string;
	modifiedContent?: string;
}

export type ChatToolDisplay =
	| ChatToolDisplayText
	| ChatToolDisplayInputOutput
	| ChatToolDisplayFileList
	| ChatToolDisplayCommand
	| ChatToolDisplayTodoList
	| ChatToolDisplayJson
	| ChatToolDisplayDiff;

export interface ChatToolResult {
	content: string;
	display?: ChatToolDisplay;
	isError?: boolean;
	structuredContent?: JsonObject;
}

export interface ChatToolContext {
	sessionId: string;
	modelId: string | null;
	workspaceRoots: string[];
	signal: AbortSignal;
	stopGeneration: () => void;
	setMode: (mode: "Agent" | "Ask" | "Edit") => void;
	readFile: (
		path: string,
		options?: { offset?: number; limit?: number },
	) => Promise<{
		content: string;
		filePath: string;
		startLine: number;
		endLine: number;
		totalLines: number;
		isPartial: boolean;
		truncated: boolean;
		fileType: "text" | "notebook" | "image" | "pdf" | "binary";
		unsupportedMessage?: string;
	}>;
	writeFile: (path: string, content: string) => Promise<{
		action: "created" | "overwritten";
		originalContent?: string;
	}>;
	editFile: (
		path: string,
		oldString: string,
		newString: string,
		replaceAll?: boolean,
	) => Promise<{
		content: string;
		originalContent?: string;
		replacements: number;
		action: "created" | "edited";
		error?: string;
	}>;
	writeNotebookCell: (
		input: {
			notebookPath: string;
			cellId?: string;
			newSource: string;
			cellType?: "code" | "markdown";
			editMode?: "replace" | "insert" | "delete";
		},
	) => Promise<{
		serializedNotebook: string;
		editedCellId?: string;
		cellType?: "code" | "markdown";
		editMode: "replace" | "insert" | "delete";
	}>;
	glob: (
		pattern: string,
		root?: string,
		options?: { headLimit?: number; offset?: number },
	) => Promise<{ items: string[]; truncated: boolean }>;
	grep: (input: JsonObject) => Promise<{
		mode: "content" | "files_with_matches" | "count";
		output: string;
		files: string[];
		truncated: boolean;
		appliedLimit?: number;
		appliedOffset?: number;
		counts?: Array<{ path: string; count: number }>;
	}>;
	runCommand: (input: {
		command: string;
		cwd?: string;
		timeoutMs?: number;
		runInBackground?: boolean;
		description?: string;
	}) => Promise<{
		stdout: string;
		stderr: string;
		exitCode: number | null;
		cwd: string;
		status?: "completed" | "running";
		backgroundTaskId?: string;
		outputPath?: string;
	}>;
	stopTask: (taskId: string) => Promise<{
		taskId: string;
		command?: string;
		status: "stopped";
	}>;
	fetchUrl: (input: {
		url: string;
		prompt?: string;
	}) => Promise<{
		url: string;
		status: number;
		contentType: string;
		bytes: number;
		content: string;
		result: string;
	}>;
	searchWeb: (input: {
		query: string;
		explanation?: string;
		allowedDomains?: string[];
		blockedDomains?: string[];
	}) => Promise<Array<{ title: string; url: string; snippet: string }>>;
	listTools: () => Array<{
		name: string;
		aliases?: string[];
		description: string;
		category: ChatToolCategory;
		inputSchema: ChatToolJsonSchema;
	}>;
	getTodos: () => Array<{
		id: string;
		content: string;
		status: "pending" | "in_progress" | "completed" | "cancelled";
	}>;
	setTodos: (
		items: Array<{
			id: string;
			content: string;
			status: "pending" | "in_progress" | "completed" | "cancelled";
		}>,
		merge: boolean,
	) => Array<{
			id: string;
			content: string;
			status: "pending" | "in_progress" | "completed" | "cancelled";
		}>;
}

export interface ChatToolDefinition<Input extends JsonObject = JsonObject> {
	name: string;
	aliases?: string[];
	source: ChatToolSource;
	category: ChatToolCategory;
	description: string;
	inputSchema: ChatToolJsonSchema;
	uiKind: ChatToolUiKind;
	readOnly: boolean | ((input: Partial<Input>) => boolean);
	concurrencySafe: boolean | ((input: Partial<Input>) => boolean);
	availability?: (context: ChatToolContext) => ChatToolAvailability;
	summarize?: (input: Partial<Input>) => string | null;
	execute: (input: Input, context: ChatToolContext) => Promise<ChatToolResult>;
}

export interface ChatToolCall {
	id: string;
	name: string;
	input: JsonObject;
}

export interface NativeToolDefinition {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: ChatToolJsonSchema;
	};
}
