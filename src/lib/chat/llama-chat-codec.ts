import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "./system-prompt";
import type { ChatToolJsonSchema } from "./tools/tool-types";
import type { AnthropicRequest } from "./types";

export interface LlamaChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | null;
	tool_calls?: Array<{
		id: string;
		type: "function";
		function: {
			name: string;
			arguments: string;
		};
	}>;
	tool_call_id?: string;
	name?: string;
}

export interface LlamaNativeTool {
	type: "function";
	function: {
		name: string;
		description: string;
		parameters: ChatToolJsonSchema;
	};
}

export interface LlamaChatCompletionRequest {
	model: string;
	messages: LlamaChatMessage[];
	stream: boolean;
	temperature: number;
	stop: string[];
	tools?: LlamaNativeTool[];
	tool_choice?: "auto" | "none";
	parallel_tool_calls?: boolean;
}

function flattenBlocks(
	content: string | Array<{ type?: string; text?: string }> | undefined | null,
): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content.map((block) => (typeof block?.text === "string" ? block.text : "")).join("");
	}
	return "";
}

function stripSentinels(text: string): string {
	return text.split(SYSTEM_PROMPT_DYNAMIC_BOUNDARY).join("").trim();
}

function mergeConsecutiveSameRole(messages: LlamaChatMessage[]): LlamaChatMessage[] {
	const merged: LlamaChatMessage[] = [];
	for (const msg of messages) {
		const prev = merged.at(-1);
		if (
			prev &&
			prev.role === msg.role &&
			!prev.tool_calls &&
			!msg.tool_calls &&
			!prev.tool_call_id &&
			!msg.tool_call_id &&
			prev.role !== "tool"
		) {
			prev.content = `${prev.content ?? ""}\n\n${msg.content ?? ""}`;
		} else {
			merged.push({ ...msg });
		}
	}
	return merged;
}

export function toLlamaMessages(request: AnthropicRequest): LlamaChatMessage[] {
	const systemMessages = request.system
		.map((content) => stripSentinels(content))
		.filter((content) => content.length > 0)
		.map((content) => ({
			role: "system" as const,
			content,
		}));

	const conversationMessages = request.messages.map((message) => ({
		role: message.role as LlamaChatMessage["role"],
		content: message.content ? flattenBlocks(message.content) : null,
		tool_calls: message.tool_calls,
		tool_call_id: message.tool_call_id,
		name: message.name,
	}));

	return mergeConsecutiveSameRole([...systemMessages, ...conversationMessages]);
}

const STOP_SEQUENCES_BY_FORMAT: Record<AnthropicRequest["format"], string[]> = {
	qwen: ["<|im_end|>", "<|endoftext|>"],
	openai: ["<|im_end|>", "<|endoftext|>"],
	gemma: ["<end_of_turn>", "<eos>"],
	anthropic: [],
};

export function buildLlamaChatCompletionRequest(
	request: AnthropicRequest,
): LlamaChatCompletionRequest {
	const payload: LlamaChatCompletionRequest = {
		model: request.model,
		messages: toLlamaMessages(request),
		stream: request.stream,
		temperature: 0.7,
		stop: STOP_SEQUENCES_BY_FORMAT[request.format] ?? [],
		tools: request.tools,
		tool_choice: request.tool_choice,
	};

	if (payload.tools?.length) {
		payload.parallel_tool_calls = false;
	}

	return payload;
}

export function filterModelTextContent(content: string): string {
	return content.replace(/<\|[^|>]*\|>/g, "");
}

export function toUserFacingLlamaServerErrorMessage(rawMessage: string): string {
	if (/n_keep.*n_ctx|context.*length|token.*limit|context.*window|context size has been exceeded/i.test(rawMessage)) {
		return "The selected model context window is too small for this conversation. Switch to a larger-context model or start a new chat.";
	}

	if (/error rendering prompt with jinja template|no user query found in messages/i.test(rawMessage)) {
		return "This model could not format the conversation with its current prompt template. Start a new chat or switch to a compatible model/template.";
	}

	return "The local model failed to process this request. Try again, start a new chat, or switch to a different model.";
}
