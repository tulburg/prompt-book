import { describe, expect, it } from "vitest";

import { buildQueryContext } from "@/lib/chat/query-context";
import { buildAnthropicRequest } from "@/lib/chat/request-builder";
import { createTranscriptEntry } from "@/lib/chat/session-store";
import type { ChatSessionState } from "@/lib/chat/types";
import type { ChatToolContext } from "@/lib/chat/tools/tool-types";

const fakeToolContext: ChatToolContext = {
	sessionId: "tool-session",
	modelId: "openai/gpt-oss-20b",
	workspaceRoots: ["/workspace"],
	signal: new AbortController().signal,
	stopGeneration: () => {},
	setMode: () => {},
	readFile: async () => ({
		content: "",
		filePath: "/workspace/file.txt",
		startLine: 1,
		endLine: 0,
		totalLines: 0,
		isPartial: false,
		truncated: false,
		fileType: "text",
	}),
	writeFile: async () => ({ action: "overwritten" }),
	editFile: async () => ({ content: "", replacements: 0, action: "edited" }),
	writeNotebookCell: async () => ({
		serializedNotebook: "",
		editMode: "replace",
	}),
	glob: async () => ({ items: [], truncated: false }),
	grep: async () => ({ mode: "files_with_matches", output: "", files: [], truncated: false, counts: [] }),
	runCommand: async () => ({ stdout: "", stderr: "", exitCode: 0, cwd: "/workspace" }),
	stopTask: async (taskId) => ({ taskId, status: "stopped" }),
	fetchUrl: async ({ url }) => ({
		url,
		status: 200,
		contentType: "text/plain",
		bytes: 0,
		content: "",
		result: "",
	}),
	searchWeb: async () => [],
	listContexts: async () => [],
	readContext: async (filename) => ({
		filename,
		title: "Codebase",
		description: "Workspace context",
		path: `/workspace/.odex/context/${filename}`,
		content: "# Codebase",
	}),
	writeContext: async (input) => ({
		filename: input.filename,
		title: input.title ?? "Codebase",
		description: input.description ?? "Workspace context",
		path: `/workspace/.odex/context/${input.filename}`,
		content: "# Codebase",
		action: "updated",
	}),
	listTools: () => [],
	getTodos: () => [],
	setTodos: (items) => items,
};

describe("request builder", () => {
	it("derives API-safe history from the canonical transcript", () => {
		const session: ChatSessionState = {
			id: "session-1",
			title: "New Chat",
			mode: "Agent",
			modelId: "local-model",
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
			closedAt: null,
			transcript: [
				createTranscriptEntry({
					role: "system",
					content: "Session bootstrapped in Agent mode.",
					visibility: "hidden",
					includeInHistory: false,
					isMeta: true,
					subtype: "bootstrap",
				}),
				createTranscriptEntry({
					role: "user",
					content: "Hello there",
					visibility: "visible",
					includeInHistory: true,
					subtype: "message",
				}),
				createTranscriptEntry({
					role: "assistant",
					content: "Streaming draft",
					visibility: "visible",
					includeInHistory: false,
					isStreaming: true,
					subtype: "message",
				}),
				createTranscriptEntry({
					role: "assistant",
					content: "Final answer",
					visibility: "visible",
					includeInHistory: true,
					subtype: "message",
				}),
			],
		};

		const request = buildAnthropicRequest({
			session,
			queryContext: buildQueryContext({
				session,
				platform: "test-platform",
				now: new Date("2026-04-02T12:00:00.000Z"),
			}),
			model: "local-model",
			provider: "llama",
		});

		expect(request.format).toBe("anthropic");
		expect(request.messages).toHaveLength(2);
		expect(request.messages[0]).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "Hello there" }],
		});
		expect(request.messages[1]).toMatchObject({
			role: "assistant",
			content: [{ type: "text", text: "Final answer" }],
		});
		expect(request.system.join("\n")).toContain("# Runtime Context");
		expect(request.system.join("\n")).toContain("# User Context");
	});

	it("switches qwen models to plain role-based context formatting", () => {
		const session: ChatSessionState = {
			id: "session-qwen",
			title: "New Chat",
			mode: "Agent",
			modelId: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
			closedAt: null,
			transcript: [
				createTranscriptEntry({
					role: "user",
					content: "Hello there",
					visibility: "visible",
					includeInHistory: true,
					subtype: "message",
				}),
			],
		};

		const request = buildAnthropicRequest({
			session,
			queryContext: buildQueryContext({
				session,
				platform: "test-platform",
				now: new Date("2026-04-02T12:00:00.000Z"),
			}),
			model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
			provider: "llama",
		});

		expect(request.format).toBe("qwen");
		expect(request.messages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "Hello there" }],
			},
		]);
		expect(request.system.join("\n")).toContain("# Runtime Context");
		expect(request.system.join("\n")).toContain("# User Context");
		expect(request.system.join("\n")).not.toContain("<system-context>");
	});

	it("uses openai profile formatting without collapsing system sections", () => {
		const session: ChatSessionState = {
			id: "session-openai",
			title: "New Chat",
			mode: "Agent",
			modelId: "openai/gpt-oss-20b",
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
			closedAt: null,
			transcript: [
				createTranscriptEntry({
					role: "user",
					content: "Hello there",
					visibility: "visible",
					includeInHistory: true,
					subtype: "message",
				}),
			],
		};

		const request = buildAnthropicRequest({
			session,
			queryContext: buildQueryContext({
				session,
				platform: "test-platform",
				now: new Date("2026-04-02T12:00:00.000Z"),
			}),
			model: "openai/gpt-oss-20b",
			modelName: "GPT OSS 20B",
			provider: "llama",
		});

		expect(request.format).toBe("openai");
		expect(request.messages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "Hello there" }],
			},
		]);
		expect(request.system.length).toBeGreaterThan(1);
		expect(request.system.join("\n")).toContain("# Runtime Context");
		expect(request.system.join("\n")).toContain("# User Context");
		expect(request.system.join("\n")).not.toContain("<system-context>");
	});

	it("attaches native tool definitions for supported models", () => {
		const session: ChatSessionState = {
			id: "session-openai-tools",
			title: "New Chat",
			mode: "Agent",
			modelId: "openai/gpt-oss-20b",
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
			closedAt: null,
			transcript: [
				createTranscriptEntry({
					role: "user",
					content: "Read a file",
					visibility: "visible",
					includeInHistory: true,
					subtype: "message",
				}),
			],
		};

		const request = buildAnthropicRequest({
			session,
			queryContext: buildQueryContext({
				session,
				platform: "test-platform",
				now: new Date("2026-04-02T12:00:00.000Z"),
			}),
			model: "openai/gpt-oss-20b",
			modelName: "GPT OSS 20B",
			provider: "llama",
			toolContext: fakeToolContext,
		});

		expect(request.nativeToolCalling).toBe(true);
		expect(request.tools?.some((tool) => tool.function.name === "Read")).toBe(true);
		expect(request.tools?.some((tool) => tool.function.name === "AskUserQuestion")).toBe(true);
		expect(request.tools?.some((tool) => tool.function.name === "Agent")).toBe(true);
		const bashTool = request.tools?.find((tool) => tool.function.name === "Bash");
		expect(bashTool?.function.parameters.properties?.timeout?.type).toBe("integer");
		expect(bashTool?.function.parameters.properties?.run_in_background?.type).toBe("boolean");
		expect(bashTool?.function.parameters.properties?.working_directory?.type).toBe("string");
		expect(request.system.join("\n")).toContain("CRITICAL: When not using native structured tool calls");
		expect(request.system.join("\n")).toContain('{"tool":"<tool_name>","arguments":{"<argument_name>":"<argument_value>"}}');
		expect(request.system.join("\n")).toContain("When you emit thinking or reasoning");
		expect(request.system.join("\n")).toContain("Listing context is the first thing to do before any executions");
		expect(request.system.join("\n")).toContain("From the provided context list, you must load at least 1 context");
		expect(request.system.join("\n")).toContain("# Available Tools");
	});

	it("serializes qwen tool turns without assistant echo text", () => {
		const session: ChatSessionState = {
			id: "session-qwen-tools",
			title: "New Chat",
			mode: "Agent",
			modelId: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
			closedAt: null,
			transcript: [
				createTranscriptEntry({
					role: "user",
					content: "Inspect the file",
					visibility: "visible",
					includeInHistory: true,
					subtype: "message",
				}),
				createTranscriptEntry({
					role: "assistant",
					content: 'Read({"file_path":"/workspace/file.txt"})',
					visibility: "visible",
					includeInHistory: true,
					subtype: "tool_use",
					toolInvocation: {
						toolCallId: "tool-1",
						toolName: "Read",
						input: { file_path: "/workspace/file.txt" },
					},
				}),
				createTranscriptEntry({
					role: "tool",
					content: "file contents",
					visibility: "visible",
					includeInHistory: true,
					subtype: "tool_result",
					toolResult: {
						toolCallId: "tool-1",
						toolName: "Read",
						input: { file_path: "/workspace/file.txt" },
						outputText: "file contents",
					},
				}),
			],
		};

		const request = buildAnthropicRequest({
			session,
			queryContext: buildQueryContext({
				session,
				platform: "test-platform",
				now: new Date("2026-04-02T12:00:00.000Z"),
			}),
			model: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
			provider: "llama",
			toolContext: fakeToolContext,
		});

		expect(request.messages).toHaveLength(3);
		expect(request.messages[1]).toEqual({
			role: "assistant",
			content: null,
			tool_calls: [
				{
					id: "tool-1",
					type: "function",
					function: {
						name: "Read",
						arguments: JSON.stringify({ file_path: "/workspace/file.txt" }),
					},
				},
			],
		});
		expect(request.messages[2]).toMatchObject({
			role: "tool",
			tool_call_id: "tool-1",
			name: "Read",
		});
		expect(request.messages[2]?.content?.[0]?.text).toContain('"ok":true');
		expect(request.messages[2]?.content?.[0]?.text).toContain("file contents");
	});

	it("serializes gemma tool results as user messages", () => {
		const session: ChatSessionState = {
			id: "session-gemma-tools",
			title: "New Chat",
			mode: "Agent",
			modelId: "google/gemma-3-27b-it",
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
			closedAt: null,
			transcript: [
				createTranscriptEntry({
					role: "assistant",
					content: 'Read({"file_path":"/workspace/file.txt"})',
					visibility: "visible",
					includeInHistory: true,
					subtype: "tool_use",
					toolInvocation: {
						toolCallId: "tool-2",
						toolName: "Read",
						input: { file_path: "/workspace/file.txt" },
					},
				}),
				createTranscriptEntry({
					role: "tool",
					content: "missing file",
					visibility: "visible",
					includeInHistory: true,
					subtype: "tool_result",
					toolResult: {
						toolCallId: "tool-2",
						toolName: "Read",
						input: { file_path: "/workspace/file.txt" },
						outputText: "missing file",
						isError: true,
					},
				}),
			],
		};

		const request = buildAnthropicRequest({
			session,
			queryContext: buildQueryContext({
				session,
				platform: "test-platform",
				now: new Date("2026-04-02T12:00:00.000Z"),
			}),
			model: "google/gemma-3-27b-it",
			modelName: "Gemma 3 27B",
			provider: "llama",
			toolContext: fakeToolContext,
		});

		expect(request.format).toBe("gemma");
		expect(request.messages).toHaveLength(2);
		expect(request.messages[1]).toMatchObject({
			role: "user",
			tool_call_id: "tool-2",
			name: "Read",
		});
		expect(request.messages[1]?.content?.[0]?.text).toContain("Tool result (error) for tool-2:");
		expect(request.messages[1]?.content?.[0]?.text).toContain('"ok":false');
		expect(request.messages[1]?.content?.[0]?.text).toContain("missing file");
	});

	it("formats Gemini requests with plain text tool history and google provider metadata", () => {
		const session: ChatSessionState = {
			id: "session-gemini",
			title: "New Chat",
			mode: "Agent",
			modelId: "gemini-2.5-flash",
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
			closedAt: null,
			transcript: [
				createTranscriptEntry({
					role: "user",
					content: "Inspect the workspace",
					visibility: "visible",
					includeInHistory: true,
					subtype: "message",
				}),
				createTranscriptEntry({
					role: "assistant",
					content: 'Read({"file_path":"/workspace/file.txt"})',
					visibility: "visible",
					includeInHistory: true,
					subtype: "tool_use",
					toolInvocation: {
						toolCallId: "tool-gemini",
						toolName: "Read",
						input: { file_path: "/workspace/file.txt" },
					},
				}),
				createTranscriptEntry({
					role: "tool",
					content: "file contents",
					visibility: "visible",
					includeInHistory: true,
					subtype: "tool_result",
					toolResult: {
						toolCallId: "tool-gemini",
						toolName: "Read",
						input: { file_path: "/workspace/file.txt" },
						outputText: "file contents",
					},
				}),
			],
		};

		const request = buildAnthropicRequest({
			session,
			queryContext: buildQueryContext({
				session,
				platform: "test-platform",
				now: new Date("2026-04-02T12:00:00.000Z"),
			}),
			model: "gemini-2.5-flash",
			modelName: "Gemini 2.5 Flash",
			provider: "google",
			toolContext: fakeToolContext,
		});

		expect(request.format).toBe("gemini");
		expect(request.nativeToolCalling).toBe(false);
		expect(request.metadata.provider).toBe("google");
		expect(request.messages[1]).toEqual({
			role: "assistant",
			content: [
				{
					type: "text",
					text: 'Read({"file_path":"/workspace/file.txt"})',
				},
			],
		});
		expect(request.messages[2]).toMatchObject({
			role: "user",
			tool_call_id: "tool-gemini",
			name: "Read",
		});
	});

	it("formats Anthropic requests with text tool history and anthropic provider metadata", () => {
		const session: ChatSessionState = {
			id: "session-claude",
			title: "New Chat",
			mode: "Agent",
			modelId: "claude-sonnet-4-6",
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
			closedAt: null,
			transcript: [
				createTranscriptEntry({
					role: "user",
					content: "Inspect the workspace",
					visibility: "visible",
					includeInHistory: true,
					subtype: "message",
				}),
				createTranscriptEntry({
					role: "assistant",
					content: 'Read({"file_path":"/workspace/file.txt"})',
					visibility: "visible",
					includeInHistory: true,
					subtype: "tool_use",
					toolInvocation: {
						toolCallId: "tool-claude",
						toolName: "Read",
						input: { file_path: "/workspace/file.txt" },
					},
				}),
				createTranscriptEntry({
					role: "tool",
					content: "file contents",
					visibility: "visible",
					includeInHistory: true,
					subtype: "tool_result",
					toolResult: {
						toolCallId: "tool-claude",
						toolName: "Read",
						input: { file_path: "/workspace/file.txt" },
						outputText: "file contents",
					},
				}),
			],
		};

		const request = buildAnthropicRequest({
			session,
			queryContext: buildQueryContext({
				session,
				platform: "test-platform",
				now: new Date("2026-04-02T12:00:00.000Z"),
			}),
			model: "claude-sonnet-4-6",
			modelName: "Claude Sonnet 4.6",
			provider: "anthropic",
			toolContext: fakeToolContext,
		});

		expect(request.format).toBe("anthropic");
		expect(request.nativeToolCalling).toBe(false);
		expect(request.metadata.provider).toBe("anthropic");
		expect(request.messages).toContainEqual({
			role: "assistant",
			content: [
				{
					type: "text",
					text: 'Read({"file_path":"/workspace/file.txt"})',
				},
			],
		});
		expect(
			request.messages.some(
				(message) =>
					message.role === "user" &&
					message.tool_call_id === "tool-claude" &&
					message.name === "Read",
			),
		).toBe(true);
	});

	it("formats OpenAI requests with native tool metadata", () => {
		const session: ChatSessionState = {
			id: "session-openai",
			title: "New Chat",
			mode: "Agent",
			modelId: "gpt-5",
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
			closedAt: null,
			transcript: [
				createTranscriptEntry({
					role: "user",
					content: "Inspect the workspace",
					visibility: "visible",
					includeInHistory: true,
					subtype: "message",
				}),
			],
		};

		const request = buildAnthropicRequest({
			session,
			queryContext: buildQueryContext({
				session,
				platform: "test-platform",
				now: new Date("2026-04-02T12:00:00.000Z"),
			}),
			model: "gpt-5",
			modelName: "GPT-5",
			provider: "openai",
			toolContext: fakeToolContext,
		});

		expect(request.format).toBe("openai");
		expect(request.nativeToolCalling).toBe(true);
		expect(request.metadata.provider).toBe("openai");
		expect(request.tools?.length ?? 0).toBeGreaterThan(0);
	});
});
