import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatService } from "@/lib/chat-service";

describe("chat service", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("sends the accepted user turn once and forwards the active mode", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [{ message: { content: "Hello back" } }],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const service = new ChatService();
		service.currentModel = {
			id: "local-model",
			displayName: "Local Model",
		};
		service.createSession();
		service.setMode("Ask");

		await service.sendMessage("Hello there");

		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(init.body)) as {
			messages: Array<{ role: string; content: string }>;
		};
		const userTurns = body.messages.filter(
			(message) => message.role === "user" && message.content.includes("Hello there"),
		);
		const systemMessages = body.messages.filter((message) => message.role === "system");

		expect(userTurns).toHaveLength(1);
		expect(systemMessages.length).toBeGreaterThan(0);
		expect(systemMessages.some((message) => message.content.includes("# Mode: Ask"))).toBe(true);
		expect(service.activeSession?.messages.at(-1)?.content).toBe("Hello back");
	});

	it("switches request structure for qwen-family models", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [{ message: { content: "Hello back" } }],
				}),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const service = new ChatService();
		service.currentModel = {
			id: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
			displayName: "Qwen3 Coder",
		};
		service.createSession();

		await service.sendMessage("Hello there");

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(init.body)) as {
			messages: Array<{ role: string; content: string }>;
		};

		expect(body.messages[0]?.role).toBe("system");
		expect(body.messages[0]?.content).toContain("# Runtime Context");
		expect(body.messages[0]?.content).toContain("# User Context");
		expect(body.messages[0]?.content).not.toContain("<system-context>");
		expect(body.messages[1]).toEqual({
			role: "user",
			content: "Hello there",
		});
	});

	it("stops an active stream and marks the partial assistant turn as stopped", async () => {
		const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(new DOMException("Aborted", "AbortError"));
				});
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		const service = new ChatService();
		service.currentModel = {
			id: "local-model",
			displayName: "Local Model",
		};
		service.createSession();

		const sendPromise = service.sendMessage("Stream please");
		service.stopGeneration();
		await sendPromise;

		const messages = service.activeSession?.messages ?? [];
		const lastMessage = messages.at(-1);
		expect(lastMessage?.role).toBe("system");
		expect(lastMessage?.content).toBe("[Request interrupted by user]");
		expect(messages.some((message) => message.content === "*[Generation stopped]*")).toBe(false);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init.signal?.aborted).toBe(true);
	});

	it("keeps repeated punctuation instead of synthesizing a detector stop message", async () => {
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
										'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
										`data: {"choices":[{"delta":{"content":"${"@".repeat(40)}"}}]}\n\n`,
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

		const service = new ChatService();
		service.currentModel = {
			id: "local-model",
			displayName: "Local Model",
		};
		service.createSession();

		await service.sendMessage("Repeat please");

		const messages = service.activeSession?.messages ?? [];
		expect(messages.at(-1)?.content).toBe(`Hello${"@".repeat(40)}`);
		expect(
			messages.some(
				(message) =>
					message.content === "*[Model produced repeated output — response stopped automatically]*",
			),
		).toBe(false);
	});
});
