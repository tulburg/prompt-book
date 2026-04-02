export type ChatRole = "user" | "assistant" | "system";

export type ChatMode = "Agent" | "Ask" | "Edit";

export type TranscriptVisibility = "visible" | "hidden";

export type TranscriptSubtype =
	| "bootstrap"
	| "user_context"
	| "error"
	| "interruption"
	| "message";

export interface ChatMessage {
	id: string;
	role: ChatRole;
	content: string;
	timestamp: number;
	isStreaming?: boolean;
	subtype?: TranscriptSubtype;
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
}

export interface ChatSessionState {
	id: string;
	title: string;
	mode: ChatMode;
	modelId: string | null;
	createdAt: number;
	bootstrappedAt: number;
	transcript: ChatTranscriptEntry[];
}

export interface ChatSession extends ChatSessionState {
	messages: ChatMessage[];
}

export interface AnthropicTextBlock {
	type: "text";
	text: string;
}

export interface AnthropicMessage {
	role: "user" | "assistant";
	content: AnthropicTextBlock[];
}

export interface AnthropicRequest {
	model: string;
	system: string[];
	messages: AnthropicMessage[];
	stream: boolean;
	format: "anthropic" | "qwen";
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
	| { type: "message_stop" };

export type ChatUiEvent =
	| { type: "stream_request_start"; sessionId: string }
	| { type: "stream_event"; sessionId: string; event: ChatTransportEvent }
	| { type: "message"; sessionId: string; message: ChatMessage };
