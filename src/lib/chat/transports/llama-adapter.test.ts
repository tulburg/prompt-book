import { describe, expect, it, vi } from "vitest";

import { buildLlamaChatPayload, LlamaChatAdapter } from "@/lib/chat/transports/llama-adapter";
import type { AnthropicRequest } from "@/lib/chat/types";

describe("llama adapter", () => {
	it("converts the internal Anthropic-shaped request into a llama payload", () => {
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

		expect(buildLlamaChatPayload(request)).toEqual({
			model: "local-model",
			stream: true,
			messages: [
				{ role: "system", content: "base system\n\n# Mode: Edit" },
				{
					role: "user",
					content: "<system-reminder>\nmode: Edit\n</system-reminder>",
				},
				{ role: "user", content: "Update this file" },
			],
		});
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
});
