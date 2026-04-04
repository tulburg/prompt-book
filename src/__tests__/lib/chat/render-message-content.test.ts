import { describe, expect, it } from "vitest";

import { parseAssistantRenderableContent } from "@/lib/chat/render-message-content";

describe("parseAssistantRenderableContent", () => {
	it("splits visible and thinking blocks", () => {
		expect(
			parseAssistantRenderableContent(
				"Intro<think>reasoning step 1\nreasoning step 2</think>Answer",
			),
		).toEqual({
			segments: [
				{ kind: "text", content: "Intro" },
				{
					kind: "thinking",
					content: "reasoning step 1\nreasoning step 2",
					isClosed: true,
				},
				{ kind: "text", content: "Answer" },
			],
			hasThinking: true,
		});
	});

	it("keeps an unterminated think block open for streaming", () => {
		expect(
			parseAssistantRenderableContent("Before<think>still thinking"),
		).toEqual({
			segments: [
				{ kind: "text", content: "Before" },
				{
					kind: "thinking",
					content: "still thinking",
					isClosed: false,
				},
			],
			hasThinking: true,
		});
	});

	it("returns plain text when no think tags exist", () => {
		expect(parseAssistantRenderableContent("Just the answer")).toEqual({
			segments: [{ kind: "text", content: "Just the answer" }],
			hasThinking: false,
		});
	});

	it("supports alternate thinking tag names", () => {
		expect(
			parseAssistantRenderableContent(
				"Before<thinking>step 1</thinking><reasoning>step 2</reasoning>After",
			),
		).toEqual({
			segments: [
				{ kind: "text", content: "Before" },
				{ kind: "thinking", content: "step 1step 2", isClosed: true },
				{ kind: "text", content: "After" },
			],
			hasThinking: true,
		});
	});
});
