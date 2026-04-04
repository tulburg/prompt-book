import { describe, expect, it, vi } from "vitest";

import {
	buildLlamaChatCompletionRequest,
	filterModelTextContent,
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

	it("filters local model control tokens from model text", () => {
		expect(filterModelTextContent("Hello<|assistant|> world<|end|>")).toBe("Hello world");
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

	it("renders reasoning_content as think-tagged text", async () => {
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
										'data: {"choices":[{"delta":{"reasoning_content":"Plan step 2."}}]}\n\n',
										'data: {"choices":[{"delta":{"content":"Final answer"}}]}\n\n',
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
		const events: string[] = [];
		for await (const event of adapter.stream(
			{
				model: "qwen-model",
				system: [],
				messages: [],
				stream: true,
				format: "qwen",
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

		expect(events.join("")).toBe("<think>Plan step 1. Plan step 2.</think>Final answer");
	});

	it("parses tool calls emitted as tool-call XML text", async () => {
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
										'data: {"choices":[{"delta":{"content":"<tool_call><function=Read><parameter=absolute_path>/tmp/demo.txt</parameter></function></tool_call>"}}]}\n\n',
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
		const textEvents: string[] = [];
		for await (const event of adapter.stream(
			{
				model: "qwen-model",
				system: [],
				messages: [],
				stream: true,
				format: "qwen",
				nativeToolCalling: true,
				tools: [
					{
						type: "function",
						function: {
							name: "Read",
							description: "Read file",
							parameters: {
								type: "object",
								properties: {
									absolute_path: { type: "string" },
								},
							},
						},
					},
				],
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
			if (event.type === "content_delta") {
				textEvents.push(event.text);
			}
		}

		expect(toolEvents).toEqual([
			{
				id: "parsed-tool-call-0",
				name: "Read",
				input: { absolute_path: "/tmp/demo.txt" },
			},
		]);
		expect(textEvents).toEqual([]);
	});
});
