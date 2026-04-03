import {
	toLlamaMessages,
	type LlamaChatMessage,
	type LlamaNativeTool,
} from "./llama-chat-codec";
import type { ChatToolJsonSchema } from "./tools/tool-types";
import type { AnthropicRequest } from "./types";

export interface OpenAiChatCompletionRequest {
	model: string;
	messages: LlamaChatMessage[];
	stream: boolean;
	tools?: LlamaNativeTool[];
	tool_choice?: "auto" | "none";
	parallel_tool_calls?: boolean;
}

export function buildOpenAiChatCompletionRequest(
	request: AnthropicRequest,
): OpenAiChatCompletionRequest {
	const payload: OpenAiChatCompletionRequest = {
		model: request.model,
		messages: toLlamaMessages(request),
		stream: request.stream,
		tools: request.tools?.map((tool) => ({
			...tool,
			function: {
				...tool.function,
				parameters: normalizeSchemaForOpenAi(tool.function.parameters),
			},
		})),
		tool_choice: request.tool_choice,
	};

	if (payload.tools?.length) {
		payload.parallel_tool_calls = false;
	}

	return payload;
}

function normalizeSchemaForOpenAi(schema: ChatToolJsonSchema): ChatToolJsonSchema {
	const normalized: ChatToolJsonSchema = { ...schema };

	if (schema.type === "object") {
		const properties = Object.fromEntries(
			Object.entries(schema.properties ?? {}).map(([key, value]) => [
				key,
				normalizeSchemaForOpenAi(value),
			]),
		);
		normalized.properties = properties;
		if (
			Object.keys(properties).length === 0 &&
			normalized.additionalProperties === undefined
		) {
			normalized.additionalProperties = true;
		}
	}

	if (schema.type === "array" && schema.items) {
		normalized.items = normalizeSchemaForOpenAi(schema.items);
	}

	return normalized;
}
