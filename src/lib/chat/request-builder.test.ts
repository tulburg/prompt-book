import { describe, expect, it } from "vitest";

import { buildQueryContext } from "@/lib/chat/query-context";
import { buildAnthropicRequest } from "@/lib/chat/request-builder";
import { createTranscriptEntry } from "@/lib/chat/session-store";
import type { ChatSessionState } from "@/lib/chat/types";

describe("request builder", () => {
	it("derives API-safe history from the canonical transcript", () => {
		const session: ChatSessionState = {
			id: "session-1",
			title: "New Chat",
			mode: "Agent",
			modelId: "local-model",
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
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
});
