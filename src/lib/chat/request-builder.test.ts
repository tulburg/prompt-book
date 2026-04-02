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
			toolContext: fakeToolContext,
		});

		expect(request.nativeToolCalling).toBe(true);
		expect(request.tools?.some((tool) => tool.function.name === "Read")).toBe(true);
		const bashTool = request.tools?.find((tool) => tool.function.name === "Bash");
		expect(bashTool?.function.parameters.properties?.timeout?.type).toBe("integer");
		expect(bashTool?.function.parameters.properties?.run_in_background?.type).toBe("boolean");
		expect(bashTool?.function.parameters.properties?.working_directory?.type).toBe("string");
		expect(request.system.join("\n")).toContain("# Available Tools");
	});
});
