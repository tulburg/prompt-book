import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	BASH_PERMITTED_COMMANDS_SETTING,
	DEFAULT_APPLICATION_SETTINGS,
} from "@/lib/application-settings";
import { ChatService } from "@/lib/chat-service";

function installOdexToolStubs() {
	Object.defineProperty(window, "projectBridge", {
		configurable: true,
		value: {
			restoreLastProject: vi.fn(async () => ({
				roots: [{ path: "/workspace" }],
			})),
			listDirectory: vi.fn(async (directoryPath: string) => {
				if (directoryPath === "/workspace/.odex") {
					return {
						path: directoryPath,
						children: [],
						permissions: { read: true, write: true, status: "granted" as const },
					};
				}
				throw new Error(`ENOENT: no such file or directory, scandir '${directoryPath}'`);
			}),
		},
	});
	Object.defineProperty(window, "ipcRenderer", {
		configurable: true,
		value: {
			invoke: vi.fn(async (channel: string, payload?: Record<string, unknown>) => {
				if (channel === "chat-tools:context-write") {
					const filename = String(payload?.filename ?? "codebase.md");
					return {
						filename,
						title: String(payload?.title ?? "Codebase"),
						description: String(payload?.description ?? "Project context"),
						path: `/workspace/.odex/context/${filename}`,
						content: String(payload?.contentBody ?? ""),
						action: "updated" as const,
					};
				}
				if (channel === "chat-tools:block-write") {
					const blockId = String(payload?.blockId ?? "core");
					return {
						id: blockId,
						title: String(payload?.title ?? "Core"),
						definition: String(payload?.definition ?? "Core workflow"),
						schemaPath: `/workspace/.odex/blocks/${blockId}/block.json`,
						diagramPath: `/workspace/.odex/blocks/${blockId}/diagram.mmd`,
						contextPath: `/workspace/.odex/context/${blockId}.md`,
						files: Array.isArray(payload?.files)
							? payload.files.filter((value): value is string => typeof value === "string")
							: [],
						action: "updated" as const,
					};
				}
				if (channel === "chat-tools:context-list" || channel === "chat-tools:block-list") {
					return { items: [] };
				}
				if (channel === "chat-tools:glob") {
					return { items: [], truncated: false };
				}
				if (channel === "chat-tools:grep") {
					return {
						mode: "files_with_matches",
						output: "",
						files: [],
						truncated: false,
						counts: [],
					};
				}
				if (channel === "chat-tools:run-command") {
					return {
						stdout: "",
						stderr: "",
						exitCode: 0,
						cwd: "/workspace",
						status: "completed",
					};
				}
				if (channel === "chat-tools:stop-task") {
					return { taskId: payload?.taskId, command: "sleep 1" };
				}
				throw new Error(`Unexpected IPC channel: ${channel}`);
			}),
		},
	});
}

describe("chat service", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		window.localStorage.clear();
		Object.defineProperty(window, "projectBridge", {
			configurable: true,
			value: undefined,
		});
		Object.defineProperty(window, "ipcRenderer", {
			configurable: true,
			value: undefined,
		});
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
			provider: "llama",
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
			(message) =>
				message.role === "user" && message.content.includes("Hello there"),
		);
		const systemMessages = body.messages.filter(
			(message) => message.role === "system",
		);

		expect(userTurns).toHaveLength(1);
		expect(systemMessages.length).toBeGreaterThan(0);
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
			provider: "llama",
		};
		service.createSession();

		await service.sendMessage("Hello there");

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(init.body)) as {
			messages: Array<{ role: string; content: string }>;
		};

		expect(body.messages[0]?.role).toBe("system");
		expect(body.messages[0]?.content).not.toContain("<system-context>");
		expect(body.messages[1]).toEqual({
			role: "user",
			content: "Hello there",
		});
	});

	it("stops an active stream and marks the partial assistant turn as stopped", async () => {
		const fetchMock = vi
			.fn()
			.mockImplementation((_url: string, init?: RequestInit) => {
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
			provider: "llama",
		};
		service.createSession();

		const sendPromise = service.sendMessage("Stream please");
		for (let attempt = 0; attempt < 5 && !service.streamingSessionId; attempt++) {
			await Promise.resolve();
		}
		service.stopGeneration();
		await sendPromise;

		const messages = service.activeSession?.messages ?? [];
		const lastMessage = messages.at(-1);
		expect(lastMessage?.role).toBe("system");
		expect(lastMessage?.content).toBe("[Request interrupted by user]");
		expect(
			messages.some((message) => message.content === "*[Generation stopped]*"),
		).toBe(false);

		if (fetchMock.mock.calls[0]) {
			const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(init.signal?.aborted).toBe(true);
		}
	});

	it("closes a chat tab while retaining the session in history", () => {
		const service = new ChatService();
		const first = service.createSession("First");
		const second = service.createSession("Second");
		const third = service.createSession("Third");

		service.setActiveSession(second.id);
		service.closeSession(second.id);

		expect(service.sessions.map((session) => session.id)).toEqual([
			first.id,
			third.id,
		]);
		expect(service.historySessions.map((session) => session.id)).toEqual([
			second.id,
		]);
		expect(service.activeSession?.id).toBe(third.id);
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
			provider: "llama",
		};
		service.createSession();

		await service.sendMessage("Repeat please");

		const messages = service.activeSession?.messages ?? [];
		expect(messages.at(-1)?.content).toBe(`Hello${"@".repeat(40)}`);
		expect(
			messages.some(
				(message) =>
					message.content ===
					"*[Model produced repeated output — response stopped automatically]*",
			),
		).toBe(false);
	});

	it("executes a native tool loop and stores tool transcript entries", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: "",
									tool_calls: [
										{
											id: "call_1",
											function: {
												name: "StructuredOutput",
												arguments: JSON.stringify({ step: "done" }),
											},
										},
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
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [{ message: { content: "Finished after tool." } }],
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
			id: "openai/gpt-oss-20b",
			displayName: "GPT OSS 20B",
			provider: "llama",
		};
		service.createSession("Odex Session");

		await service.sendMessage("Use a tool");

		expect(fetchMock).toHaveBeenCalledTimes(2);
		const messages = service.activeSession?.messages ?? [];
		expect(messages.some((message) => message.subtype === "tool_use")).toBe(
			true,
		);
		expect(messages.some((message) => message.subtype === "tool_result")).toBe(
			true,
		);
		expect(messages.at(-1)?.content).toBe("Finished after tool.");
	});

	it("enforces Odex metadata writes before allowing the model to finish", async () => {
		installOdexToolStubs();
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [{ message: { content: "Done without metadata." } }],
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: "",
									tool_calls: [
										{
											id: "call_context",
											function: {
												name: "Context",
												arguments: JSON.stringify({
													action: "write",
													filename: "codebase.md",
													title: "Codebase",
													description: "Current codebase context.",
													content_body: "Chat service sends requests and manages sessions.\n\nCaptured the latest workflow notes.",
												}),
											},
										},
										{
											id: "call_block",
											function: {
												name: "Block",
												arguments: JSON.stringify({
													action: "write",
													block_id: "chat-flow",
													title: "Chat Flow",
													definition: "Chat request and tool execution flow.",
													files: ["/workspace/src/lib/chat-service.ts"],
												}),
											},
										},
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
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [{ message: { content: "Finished after metadata updates." } }],
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
			id: "openai/gpt-oss-20b",
			displayName: "GPT OSS 20B",
			provider: "llama",
		};
		service.createSession("Odex Session");

		await service.sendMessage("Inspect the project and keep Odex metadata up to date.");

		expect(fetchMock).toHaveBeenCalledTimes(3);
		const messages = service.activeSession?.messages ?? [];
		expect(messages.some((message) => message.content === "Done without metadata.")).toBe(
			false,
		);
		expect(
			messages.some(
				(message) => message.toolResult?.toolName === "Context" && message.subtype === "tool_result",
			),
		).toBe(true);
		expect(
			messages.some(
				(message) => message.toolResult?.toolName === "Block" && message.subtype === "tool_result",
			),
		).toBe(true);
		expect(messages.at(-1)?.content).toBe("Finished after metadata updates.");
	});

	it("pauses the tool loop after AskUserQuestion so the next user reply can continue", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: "",
								tool_calls: [
									{
										id: "call_question",
										function: {
											name: "AskUserQuestion",
											arguments: JSON.stringify({
												title: "Clarify scope",
												questions: [
													{
														id: "q1",
														prompt: "Which path should I take?",
														options: [
															{ id: "a", label: "Option A" },
															{ id: "b", label: "Option B" },
														],
													},
												],
											}),
										},
									},
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
		);
		vi.stubGlobal("fetch", fetchMock);

		const service = new ChatService();
		service.currentModel = {
			id: "openai/gpt-oss-20b",
			displayName: "GPT OSS 20B",
			provider: "llama",
		};
		service.createSession();

		await service.sendMessage("Use a question tool");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const messages = service.activeSession?.messages ?? [];
		const toolResult = messages.find((message) => message.subtype === "tool_result");
		expect(toolResult?.toolResult?.toolName).toBe("AskUserQuestion");
		expect(toolResult?.toolResult?.display?.kind).toBe("question");
		expect(messages.at(-1)?.subtype).toBe("tool_result");
	});

	it("persists approved bash commands and allows the retried command", async () => {
		const runCommandMock = vi.fn(async () => ({
			stdout: "installed",
			stderr: "",
			exitCode: 0,
			cwd: "/workspace",
			status: "completed" as const,
		}));
		const saveSettingsMock = vi.fn(async (settings) => settings);

		Object.defineProperty(window, "projectBridge", {
			configurable: true,
			value: {
				restoreLastProject: vi.fn(async () => ({
					roots: [{ path: "/workspace" }],
				})),
				listDirectory: vi.fn(async (directoryPath: string) => {
					throw new Error(
						`ENOENT: no such file or directory, scandir '${directoryPath}'`,
					);
				}),
			},
		});
		Object.defineProperty(window, "settingsBridge", {
			configurable: true,
			value: {
				load: vi.fn(async () => DEFAULT_APPLICATION_SETTINGS),
				save: saveSettingsMock,
			},
		});
		Object.defineProperty(window, "ipcRenderer", {
			configurable: true,
			value: {
				invoke: vi.fn(async (channel: string, payload?: Record<string, unknown>) => {
					if (channel === "chat-tools:run-command") {
						return runCommandMock(payload);
					}
					if (channel === "chat-tools:glob") {
						return { items: [], truncated: false };
					}
					if (channel === "chat-tools:grep") {
						return {
							mode: "files_with_matches",
							output: "",
							files: [],
							truncated: false,
							counts: [],
						};
					}
					if (channel === "chat-tools:stop-task") {
						return { taskId: payload?.taskId, command: "npm install" };
					}
					throw new Error(`Unexpected IPC channel: ${channel}`);
				}),
			},
		});

		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: "",
									tool_calls: [
										{
											id: "call_bash_pending",
											function: {
												name: "Bash",
												arguments: JSON.stringify({
													command: "npm install",
													description: "Install dependencies",
												}),
											},
										},
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
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: "",
									tool_calls: [
										{
											id: "call_bash_retry",
											function: {
												name: "Bash",
												arguments: JSON.stringify({
													command: "npm install",
													description: "Install dependencies",
												}),
											},
										},
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
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [{ message: { content: "Dependencies installed." } }],
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
			id: "openai/gpt-oss-20b",
			displayName: "GPT OSS 20B",
			provider: "llama",
		};
		service.createSession("Bash Approval");

		await service.sendMessage("Install the dependencies", {
			settings: DEFAULT_APPLICATION_SETTINGS,
		});

		expect(runCommandMock).not.toHaveBeenCalled();
		expect(saveSettingsMock).not.toHaveBeenCalled();

		await service.sendMessage("Approve and run", {
			settings: DEFAULT_APPLICATION_SETTINGS,
		});

		expect(saveSettingsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				[BASH_PERMITTED_COMMANDS_SETTING]: ["npm install"],
			}),
		);
		expect(runCommandMock).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "npm install",
				description: "Install dependencies",
			}),
		);
		expect(service.activeSession?.messages.at(-1)?.content).toBe(
			"Dependencies installed.",
		);
	});

	it("strips echoed tool invocation text from assistant messages", async () => {
		const toolInput = {
			command:
				'find /Users/tulburg/Developer/stream-x -name "package.json" -o -name "requirements.txt"',
			description: "Find backend and root package files",
		};
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: `Bash(${JSON.stringify(toolInput)})\n\n${toolInput.description}\n${toolInput.command}`,
									tool_calls: [
										{
											id: "call_1",
											function: {
												name: "Bash",
												arguments: JSON.stringify(toolInput),
											},
										},
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
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [{ message: { content: "Done searching." } }],
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
			id: "openai/gpt-oss-20b",
			displayName: "GPT OSS 20B",
			provider: "llama",
		};
		service.createSession();

		await service.sendMessage("Search the repo");

		const messages = service.activeSession?.messages ?? [];
		expect(
			messages.some(
				(message) =>
					message.subtype === "message" && message.content.includes("Bash("),
			),
		).toBe(false);
		expect(messages.some((message) => message.subtype === "tool_use")).toBe(
			true,
		);
		expect(messages.some((message) => message.subtype === "tool_result")).toBe(
			true,
		);
		expect(messages.at(-1)?.content).toBe("Done searching.");
	});

	it("routes Gemini models through the Google transport when configured", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				new ReadableStream({
					start(controller) {
						const encoder = new TextEncoder();
						controller.enqueue(
							encoder.encode(
								'data: {"candidates":[{"content":{"parts":[{"text":"Gemini reply"}]}}]}\n\n',
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
		);
		vi.stubGlobal("fetch", fetchMock);

		const service = new ChatService();
		service.currentModel = {
			id: "gemini-2.5-flash",
			displayName: "Gemini 2.5 Flash",
			provider: "google",
		};
		service.createSession();

		await service.sendMessage("Hello Gemini", {
			settings: {
				...DEFAULT_APPLICATION_SETTINGS,
				"chat.providers.google.apiKey": "test-key",
			},
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("generativelanguage.googleapis.com");
		expect(init.headers).toMatchObject({
			"x-goog-api-key": "test-key",
		});
		expect(service.activeSession?.messages.at(-1)?.content).toBe("Gemini reply");
	});

	it("routes OpenAI models through the OpenAI transport when configured", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				new ReadableStream({
					start(controller) {
						const encoder = new TextEncoder();
						controller.enqueue(
							encoder.encode(
								'data: {"choices":[{"delta":{"content":"OpenAI reply"}}]}\n\n',
							),
						);
						controller.enqueue(encoder.encode("data: [DONE]\n\n"));
						controller.close();
					},
				}),
				{
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				},
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const service = new ChatService();
		service.currentModel = {
			id: "gpt-5",
			displayName: "GPT-5",
			provider: "openai",
		};
		service.createSession();

		await service.sendMessage("Hello OpenAI", {
			settings: {
				...DEFAULT_APPLICATION_SETTINGS,
				"chat.providers.openai.apiKey": "test-key",
			},
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("api.openai.com/v1/chat/completions");
		expect(init.headers).toMatchObject({
			Authorization: "Bearer test-key",
		});
		expect(service.activeSession?.messages.at(-1)?.content).toBe("OpenAI reply");
	});

	it("does not retry non-retryable OpenAI request-shape errors", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						type: "invalid_request_error",
						message:
							"Invalid schema for function 'StructuredOutput': In context=(), object schema missing properties.",
					},
				}),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				},
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const service = new ChatService();
		service.currentModel = {
			id: "gpt-5",
			displayName: "GPT-5",
			provider: "openai",
		};
		service.createSession();

		await service.sendMessage("Hello OpenAI", {
			settings: {
				...DEFAULT_APPLICATION_SETTINGS,
				"chat.providers.openai.apiKey": "test-key",
			},
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(service.activeSession?.messages.at(-1)?.content).toBe(
			"OpenAI request failed: Invalid schema for function 'StructuredOutput': In context=(), object schema missing properties.",
		);
	});

	it("does not retry OpenAI rate limit errors", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
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
		);
		vi.stubGlobal("fetch", fetchMock);

		const service = new ChatService();
		service.currentModel = {
			id: "gpt-5",
			displayName: "GPT-5",
			provider: "openai",
		};
		service.createSession();

		await service.sendMessage("Hello OpenAI", {
			settings: {
				...DEFAULT_APPLICATION_SETTINGS,
				"chat.providers.openai.apiKey": "test-key",
			},
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(service.activeSession?.messages.at(-1)?.content).toBe(
			"OpenAI rate limit exceeded for gpt-5. Wait a moment and try again, or switch models.",
		);
	});
});
