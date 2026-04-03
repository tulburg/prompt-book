import { describe, expect, it, vi } from "vitest";

import {
	fetchOpenAiModels,
	isSupportedOpenAiChatModelId,
} from "@/lib/chat/openai-model-discovery";

describe("openai model discovery", () => {
	it("filters the models endpoint down to chat-capable OpenAI models", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						data: [
							{ id: "text-embedding-3-large" },
							{ id: "gpt-5-mini" },
							{ id: "gpt-5" },
							{ id: "gpt-image-1" },
							{ id: "o3" },
							{ id: "whisper-1" },
						],
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
			),
		);

		await expect(fetchOpenAiModels("test-key")).resolves.toEqual([
			{
				id: "gpt-5",
				displayName: "GPT-5",
				provider: "openai",
				vision: true,
				trainedForToolUse: true,
			},
			{
				id: "gpt-5-mini",
				displayName: "GPT-5 Mini",
				provider: "openai",
				vision: true,
				trainedForToolUse: true,
			},
			{
				id: "o3",
				displayName: "O3",
				provider: "openai",
				vision: true,
				trainedForToolUse: true,
			},
		]);
	});

	it("recognizes supported OpenAI chat model ids", () => {
		expect(isSupportedOpenAiChatModelId("gpt-5")).toBe(true);
		expect(isSupportedOpenAiChatModelId("gpt-5-mini")).toBe(true);
		expect(isSupportedOpenAiChatModelId("o3")).toBe(true);
		expect(isSupportedOpenAiChatModelId("text-embedding-3-large")).toBe(false);
		expect(isSupportedOpenAiChatModelId("whisper-1")).toBe(false);
	});
});
