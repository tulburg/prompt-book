import { describe, expect, it, vi } from "vitest";

import {
	buildLlamaChatCompletionRequest,
	filterModelTextContent,
	toUserFacingLlamaServerErrorMessage,
} from "@/lib/chat/llama-chat-codec";
import { LlamaChatAdapter } from "@/lib/chat/transports/llama-adapter";
import type { AnthropicRequest } from "@/lib/chat/types";

describe("llama adapter", () => {
	it("converts the internal request into a llama payload", () => {
		const request: AnthropicRequest = {
			model: "local-model",
			system: ["base system", "# Mode: Edit"],
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "<system-reminder>\nmode: Edit\n</system-reminder>" }],
				},
				{
					role: "user",
					content: [{ type: "text", text: "Update this file" }],
				},
			],
			stream: true,
			format: "anthropic",
			metadata: {
				sessionId: "session-1",
				mode: "Edit",
				provider: "llama",
			},
		};

		expect(buildLlamaChatCompletionRequest(request)).toEqual({
			model: "local-model",
			stream: true,
			temperature: 0.7,
			stop: [],
			messages: [
				{ role: "system", content: "base system\n\n# Mode: Edit" },
				{
					role: "user",
					content: "<system-reminder>\nmode: Edit\n</system-reminder>\n\nUpdate this file",
				},
			],
		});
	});

	it("strips __SYSTEM_PROMPT_DYNAMIC_BOUNDARY__ from system sections", () => {
		const request: AnthropicRequest = {
			model: "qwen-model",
			system: [
				"# Identity\nYou are helpful.\n\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n\n# Mode: Agent",
			],
			messages: [
				{ role: "user", content: [{ type: "text", text: "hi" }] },
			],
			stream: true,
			format: "qwen",
			metadata: { sessionId: "s", mode: "Agent", provider: "llama" },
		};

		const result = buildLlamaChatCompletionRequest(request);
		const systemContent = result.messages
			.filter((m) => m.role === "system")
			.map((m) => m.content)
			.join("\n");
		expect(systemContent).not.toContain("__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__");
		expect(systemContent).toContain("# Identity");
		expect(systemContent).toContain("# Mode: Agent");
	});

	it("includes model-appropriate stop tokens for qwen format", () => {
		const request: AnthropicRequest = {
			model: "qwen-model",
			system: ["system"],
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
			stream: true,
			format: "qwen",
			metadata: { sessionId: "s", mode: "Agent", provider: "llama" },
		};

		const result = buildLlamaChatCompletionRequest(request);
		expect(result.stop).toContain("<|im_end|>");
		expect(result.temperature).toBe(0.7);
	});

	it("filters local model control tokens from model text", () => {
		expect(filterModelTextContent("Hello<|assistant|> world<|end|>")).toBe("Hello world");
	});

	it("maps local model prompt template mismatches to a clearer user error", () => {
		expect(
			toUserFacingLlamaServerErrorMessage(
				"Llama server chat completions request failed with status 400: error rendering prompt with jinja template",
			),
		).toContain("could not format the conversation");
	});
});

describe("llama adapter streaming", () => {
	it("passes repeated punctuation through unchanged", async () => {
		const encoder = new TextEncoder();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(
								encoder.encode(
									`data: {"choices":[{"delta":{"content":"${"@".repeat(40)}"}}]}\n\n`,
								),
							);
							controller.close();
						},
					}),
					{
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					},
				),
			),
		);

		const adapter = new LlamaChatAdapter();
		const events: string[] = [];
		for await (const event of adapter.stream(
			{
				model: "local-model",
				system: [],
				messages: [],
				stream: true,
				format: "anthropic",
				metadata: {
					sessionId: "session-1",
					mode: "Agent",
					provider: "llama",
				},
			},
			{ signal: new AbortController().signal },
		)) {
			if (event.type === "content_delta") {
				events.push(event.text);
			}
		}

		expect(events).toEqual(["@".repeat(40)]);
	});

	it("parses streamed tool calls", async () => {
		const encoder = new TextEncoder();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(
								encoder.encode(
									[
										'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"StructuredOutput","arguments":"{\\"status\\":\\""}}]}}]}\n\n',
										'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ok\\"}"}}]}}]}\n\n',
									].join(""),
								),
							);
							controller.close();
						},
					}),
					{
						status: 200,
						headers: { "Content-Type": "text/event-stream" },
					},
				),
			),
		);

		const adapter = new LlamaChatAdapter();
		const toolEvents: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
		for await (const event of adapter.stream(
			{
				model: "openai/gpt-oss-20b",
				system: [],
				messages: [],
				stream: true,
				format: "openai",
				nativeToolCalling: true,
				tools: [],
				tool_choice: "auto",
				metadata: {
					sessionId: "session-1",
					mode: "Agent",
					provider: "llama",
				},
			},
			{ signal: new AbortController().signal },
		)) {
			if (event.type === "tool_calls") {
				toolEvents.push(...event.calls);
			}
		}

		expect(toolEvents).toEqual([
			{
				id: "call_1",
				name: "StructuredOutput",
				input: { status: "ok" },
			},
		]);
	});
});
