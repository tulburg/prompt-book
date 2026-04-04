import { describe, expect, it, vi } from "vitest";

import { buildOpenAiChatCompletionRequest } from "@/lib/chat/openai-chat-codec";
import { OpenAiChatAdapter } from "@/lib/chat/transports/openai-adapter";
import type { AnthropicRequest } from "@/lib/chat/types";

describe("openai chat codec", () => {
	it("converts the internal request into an OpenAI chat completions payload", () => {
		const request: AnthropicRequest = {
			model: "gpt-5",
			system: ["# Identity\nYou are helpful.", "# Mode: Agent"],
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "Inspect the file" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "I will inspect it." }],
				},
			],
			stream: true,
			format: "openai",
			metadata: {
				sessionId: "session-1",
				mode: "Agent",
				provider: "openai",
			},
		};

		expect(buildOpenAiChatCompletionRequest(request)).toEqual({
			model: "gpt-5",
			messages: [
				{
					role: "system",
					content: "# Identity\nYou are helpful.\n\n# Mode: Agent",
				},
				{
					role: "user",
					content: "Inspect the file",
					name: undefined,
					tool_call_id: undefined,
					tool_calls: undefined,
				},
				{
					role: "assistant",
					content: "I will inspect it.",
					name: undefined,
					tool_call_id: undefined,
					tool_calls: undefined,
				},
			],
			stream: true,
			tool_choice: undefined,
			tools: undefined,
		});
	});

	it("normalizes object tool schemas for OpenAI function calling", () => {
		const request: AnthropicRequest = {
			model: "gpt-5",
			system: [],
			messages: [],
			stream: true,
			format: "openai",
			tools: [
				{
					type: "function",
					function: {
						name: "StructuredOutput",
						description: "Emit JSON",
						parameters: {
							type: "object",
							description: "Arbitrary JSON object to emit.",
						},
					},
				},
			],
			tool_choice: "auto",
			metadata: {
				sessionId: "session-1",
				mode: "Agent",
				provider: "openai",
			},
		};

		expect(buildOpenAiChatCompletionRequest(request).tools).toEqual([
			{
				type: "function",
				function: {
					name: "StructuredOutput",
					description: "Emit JSON",
					parameters: {
						type: "object",
						description: "Arbitrary JSON object to emit.",
						properties: {},
						additionalProperties: true,
					},
				},
			},
		]);
	});
});

describe("openai adapter", () => {
	it("streams text fragments and native tool calls from OpenAI SSE responses", async () => {
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
										'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
										'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
										'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"Read","arguments":"{\\"file_path\\":\\"/tmp/demo.txt\\"}"}}]}}]}\n\n',
										"data: [DONE]\n\n",
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

		const adapter = new OpenAiChatAdapter();
		const textEvents: string[] = [];
		const toolEvents: Array<{
			id: string;
			name: string;
			input: Record<string, unknown>;
		}> = [];
		for await (const event of adapter.stream(
			{
				model: "gpt-5",
				system: [],
				messages: [],
				stream: true,
				format: "openai",
				metadata: {
					sessionId: "session-1",
					mode: "Agent",
					provider: "openai",
				},
			},
			{ signal: new AbortController().signal, apiKey: "test-key" },
		)) {
			if (event.type === "content_delta") {
				textEvents.push(event.text);
			}
			if (event.type === "tool_calls") {
				toolEvents.push(...event.calls);
			}
		}

		expect(textEvents.join("")).toBe("Hello world");
		expect(toolEvents).toEqual([
			{
				id: "call_1",
				name: "Read",
				input: { file_path: "/tmp/demo.txt" },
			},
		]);
	});

	it("wraps streamed OpenAI reasoning fields in think tags", async () => {
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
										'data: {"choices":[{"delta":{"reasoning_content":"Plan step 1. "}}]}\n\n',
										'data: {"choices":[{"delta":{"reasoning":{"text":"Plan step 2."}}}]}\n\n',
										'data: {"choices":[{"delta":{"content":"Final answer"}}]}\n\n',
										"data: [DONE]\n\n",
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

		const adapter = new OpenAiChatAdapter();
		const textEvents: string[] = [];
		for await (const event of adapter.stream(
			{
				model: "gpt-5",
				system: [],
				messages: [],
				stream: true,
				format: "openai",
				metadata: {
					sessionId: "session-1",
					mode: "Agent",
					provider: "openai",
				},
			},
			{ signal: new AbortController().signal, apiKey: "test-key" },
		)) {
			if (event.type === "content_delta") {
				textEvents.push(event.text);
			}
		}

		expect(textEvents.join("")).toBe(
			"<think>Plan step 1. Plan step 2.</think>Final answer",
		);
	});

	it("keeps reasoning content blocks out of visible OpenAI output", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: [
										{ type: "reasoning_text", text: "Private reasoning. " },
										{ type: "summary_text", text: "Summary. " },
										{ type: "output_text", text: "Final answer" },
									],
								},
							},
						],
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		);

		const adapter = new OpenAiChatAdapter();
		const textEvents: string[] = [];
		for await (const event of adapter.stream(
			{
				model: "gpt-5",
				system: [],
				messages: [],
				stream: false,
				format: "openai",
				metadata: {
					sessionId: "session-1",
					mode: "Agent",
					provider: "openai",
				},
			},
			{ signal: new AbortController().signal, apiKey: "test-key" },
		)) {
			if (event.type === "content_delta") {
				textEvents.push(event.text);
			}
		}

		expect(textEvents.join("")).toBe(
			"<think>Private reasoning. Summary. </think>Final answer",
		);
	});

	it("maps OpenAI quota errors to a short user-facing message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: {
							type: "rate_limit_error",
							code: "insufficient_quota",
							message: "You exceeded your current quota.",
						},
					}),
					{
						status: 429,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		);

		const adapter = new OpenAiChatAdapter();
		const consume = async () => {
			for await (const _event of adapter.stream(
				{
					model: "gpt-5",
					system: [],
					messages: [],
					stream: true,
					format: "openai",
					metadata: {
						sessionId: "session-1",
						mode: "Agent",
						provider: "openai",
					},
				},
				{ signal: new AbortController().signal, apiKey: "test-key" },
			)) {
				// consume
			}
		};

		await expect(consume()).rejects.toThrow(
			"OpenAI rate limit exceeded for gpt-5. Wait a moment and try again, or switch models.",
		);
	});

	it("includes retry-after guidance for OpenAI rate limits", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: {
							type: "rate_limit_error",
							code: "rate_limit_exceeded",
							message: "Rate limit exceeded.",
						},
					}),
					{
						status: 429,
						headers: {
							"Content-Type": "application/json",
							"Retry-After": "12",
						},
					},
				),
			),
		);

		const adapter = new OpenAiChatAdapter();
		const consume = async () => {
			for await (const _event of adapter.stream(
				{
					model: "gpt-5",
					system: [],
					messages: [],
					stream: true,
					format: "openai",
					metadata: {
						sessionId: "session-1",
						mode: "Agent",
						provider: "openai",
					},
				},
				{ signal: new AbortController().signal, apiKey: "test-key" },
			)) {
				// consume
			}
		};

		await expect(consume()).rejects.toThrow(
			"OpenAI rate limit exceeded for gpt-5. Try again in about 12 seconds.",
		);
	});
});
