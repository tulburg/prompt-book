import { describe, expect, it, vi } from "vitest";

import { buildAnthropicMessagesRequest } from "@/lib/chat/anthropic-chat-codec";
import { AnthropicChatAdapter } from "@/lib/chat/transports/anthropic-adapter";
import type { AnthropicRequest } from "@/lib/chat/types";

describe("anthropic chat codec", () => {
	it("converts the internal request into an Anthropic messages payload", () => {
		const request: AnthropicRequest = {
			model: "claude-sonnet-4-6",
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
			format: "anthropic",
			metadata: {
				sessionId: "session-1",
				mode: "Agent",
				provider: "anthropic",
			},
		};

		expect(buildAnthropicMessagesRequest(request)).toEqual({
			model: "claude-sonnet-4-6",
			system: "# Identity\nYou are helpful.\n\n# Mode: Agent",
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
			max_tokens: 4096,
			stream: true,
			temperature: 0.7,
		});
	});
});

describe("anthropic adapter", () => {
	it("streams text fragments from Anthropic SSE responses", async () => {
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
										'event: message_start\ndata: {"type":"message_start"}\n\n',
										'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}\n\n',
										'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}\n\n',
										'event: message_stop\ndata: {"type":"message_stop"}\n\n',
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

		const adapter = new AnthropicChatAdapter();
		const events: string[] = [];
		for await (const event of adapter.stream(
			{
				model: "claude-sonnet-4-6",
				system: [],
				messages: [],
				stream: true,
				format: "anthropic",
				metadata: {
					sessionId: "session-1",
					mode: "Agent",
					provider: "anthropic",
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

	it("maps Anthropic authentication errors to a short user-facing message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						error: {
							type: "authentication_error",
							message: "invalid x-api-key",
						},
					}),
					{
						status: 401,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		);

		const adapter = new AnthropicChatAdapter();
		const consume = async () => {
			for await (const _event of adapter.stream(
				{
					model: "claude-sonnet-4-6",
					system: [],
					messages: [],
					stream: true,
					format: "anthropic",
					metadata: {
						sessionId: "session-1",
						mode: "Agent",
						provider: "anthropic",
					},
				},
				{ signal: new AbortController().signal, apiKey: "test-key" },
			)) {
				// consume
			}
		};

		await expect(consume()).rejects.toThrow(
			"Anthropic authentication failed. Check your Anthropic API key in Settings and try again.",
		);
	});
});
