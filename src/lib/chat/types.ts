import type {
	ChatToolDisplay,
	NativeToolDefinition,
	JsonObject,
} from "./tools/tool-types";

export type ChatRole = "user" | "assistant" | "system" | "tool";

export type ChatMode = "Agent" | "Ask" | "Edit";

export type TranscriptVisibility = "visible" | "hidden";

export type TranscriptSubtype =
	| "bootstrap"
	| "user_context"
	| "error"
	| "interruption"
	| "message"
	| "tool_use"
	| "tool_result";

export interface ChatToolInvocationRecord {
	toolCallId: string;
	toolName: string;
	input: JsonObject;
}

export interface ChatToolResultRecord {
	toolCallId: string;
	toolName: string;
	input: JsonObject;
	outputText: string;
	display?: ChatToolDisplay;
	isError?: boolean;
	structuredContent?: JsonObject;
}

export interface ChatMessage {
	id: string;
	role: ChatRole;
	content: string;
	timestamp: number;
	isStreaming?: boolean;
	subtype?: TranscriptSubtype;
	toolInvocation?: ChatToolInvocationRecord;
	toolResult?: ChatToolResultRecord;
}

export interface ChatTranscriptEntry {
	id: string;
	role: ChatRole;
	content: string;
	timestamp: number;
	visibility: TranscriptVisibility;
	isStreaming?: boolean;
	includeInHistory: boolean;
	isMeta?: boolean;
	subtype?: TranscriptSubtype;
	toolInvocation?: ChatToolInvocationRecord;
	toolResult?: ChatToolResultRecord;
}

export interface ChatSessionState {
	id: string;
	title: string;
	mode: ChatMode;
	modelId: string | null;
	createdAt: number;
	bootstrappedAt: number;
	closedAt: number | null;
	todos: Array<{
		id: string;
		content: string;
		status: "pending" | "in_progress" | "completed" | "cancelled";
	}>;
	transcript: ChatTranscriptEntry[];
}

export interface ChatSession extends ChatSessionState {
	messages: ChatMessage[];
}

export interface AnthropicTextBlock {
	type: "text";
	text: string;
}

export interface ChatApiToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

export interface ChatApiMessage {
	role: "user" | "assistant" | "tool";
	content: AnthropicTextBlock[] | null;
	tool_calls?: ChatApiToolCall[];
	tool_call_id?: string;
	name?: string;
}

export interface AnthropicRequest {
	model: string;
	system: string[];
	messages: ChatApiMessage[];
	stream: boolean;
	format: "anthropic" | "openai" | "qwen" | "gemma";
	tools?: NativeToolDefinition[];
	tool_choice?: "auto" | "none";
	nativeToolCalling?: boolean;
	metadata: {
		sessionId: string;
		mode: ChatMode;
		provider: "llama";
	};
}

export interface ChatQueryContext {
	systemPrompt: string[];
	systemContext: Record<string, string>;
	userContext: Record<string, string>;
}

export type ChatStreamMode = "idle" | "requesting" | "responding";

export type ChatTransportEvent =
	| { type: "message_start" }
	| { type: "content_delta"; text: string }
	| {
			type: "tool_calls";
			calls: Array<{
				id: string;
				name: string;
				input: JsonObject;
			}>;
	  }
	| { type: "message_stop" };

export type ChatUiEvent =
	| { type: "stream_request_start"; sessionId: string }
	| { type: "stream_event"; sessionId: string; event: ChatTransportEvent }
	| { type: "message"; sessionId: string; message: ChatMessage };
