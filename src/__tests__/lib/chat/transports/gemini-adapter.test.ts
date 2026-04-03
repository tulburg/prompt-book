import { describe, expect, it, vi } from "vitest";

import { buildGeminiGenerateContentRequest } from "@/lib/chat/gemini-chat-codec";
import { GeminiChatAdapter } from "@/lib/chat/transports/gemini-adapter";
import type { AnthropicRequest } from "@/lib/chat/types";

describe("gemini chat codec", () => {
	it("converts the internal request into a Gemini payload", () => {
		const request: AnthropicRequest = {
			model: "gemini-2.5-flash",
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
			format: "gemini",
			metadata: {
				sessionId: "session-1",
				mode: "Agent",
				provider: "google",
			},
		};

		expect(buildGeminiGenerateContentRequest(request)).toEqual({
			systemInstruction: {
				parts: [{ text: "# Identity\nYou are helpful.\n\n# Mode: Agent" }],
			},
			contents: [
				{ role: "user", parts: [{ text: "Inspect the file" }] },
				{ role: "model", parts: [{ text: "I will inspect it." }] },
			],
			generationConfig: {
				temperature: 0.7,
			},
		});
	});
});

describe("gemini adapter", () => {
	it("streams text fragments from Gemini SSE responses", async () => {
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
										'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\n',
										'data: {"candidates":[{"content":{"parts":[{"text":"world"}]}}]}\n\n',
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

		const adapter = new GeminiChatAdapter();
		const events: string[] = [];
		for await (const event of adapter.stream(
			{
				model: "gemini-2.5-flash",
				system: [],
				messages: [],
				stream: true,
				format: "gemini",
				metadata: {
					sessionId: "session-1",
					mode: "Agent",
					provider: "google",
				},
			},
			{ signal: new AbortController().signal, apiKey: "test-key" },
		)) {
			if (event.type === "content_delta") {
				events.push(event.text);
			}
		}

		expect(events.join("")).toBe("Hello world");
	});

	it("parses tool calls emitted as plain JSON text", async () => {
		const encoder = new TextEncoder();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(
								encoder.encode(
									'data: {"candidates":[{"content":{"parts":[{"text":"{\\"tool\\":\\"Read\\",\\"arguments\\":{\\"file_path\\":\\"/tmp/demo.txt\\"}}"}]}}]}\n\n',
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

		const adapter = new GeminiChatAdapter();
		const toolEvents: Array<{
			id: string;
			name: string;
			input: Record<string, unknown>;
		}> = [];
		for await (const event of adapter.stream(
			{
				model: "gemini-2.5-flash",
				system: [],
				messages: [],
				stream: true,
				format: "gemini",
				metadata: {
					sessionId: "session-1",
					mode: "Agent",
					provider: "google",
				},
			},
			{ signal: new AbortController().signal, apiKey: "test-key" },
		)) {
			if (event.type === "tool_calls") {
				toolEvents.push(...event.calls);
			}
		}

		expect(toolEvents).toEqual([
			{
				id: "parsed-tool-call-0",
				name: "Read",
				input: { file_path: "/tmp/demo.txt" },
			},
		]);
	});

	it("maps Gemini quota errors to a short user-facing message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: {
							code: 429,
							message:
								"Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests",
							status: "RESOURCE_EXHAUSTED",
							details: [
								{
									"@type": "type.googleapis.com/google.rpc.RetryInfo",
									retryDelay: "52s",
								},
							],
						},
					}),
					{
						status: 429,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		);

		const adapter = new GeminiChatAdapter();
		const consume = async () => {
			for await (const _event of adapter.stream(
				{
					model: "gemini-2.5-pro",
					system: [],
					messages: [],
					stream: true,
					format: "gemini",
					metadata: {
						sessionId: "session-1",
						mode: "Agent",
						provider: "google",
					},
				},
				{ signal: new AbortController().signal, apiKey: "test-key" },
			)) {
				// consume
			}
		};

		await expect(consume()).rejects.toThrow(
			"Gemini quota exceeded for gemini-2.5-pro. Check your Gemini plan or billing details, or switch models. Try again in about 52 seconds.",
		);
	});
});
