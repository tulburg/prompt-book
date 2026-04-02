import { describe, expect, it } from "vitest";

import { resolveChatModelProfile } from "@/lib/chat/model-profiles";

describe("chat model profiles", () => {
	it("defaults to anthropic-compatible formatting when no profile matches", () => {
		expect(
			resolveChatModelProfile({
				modelId: "mistral/small-3.1",
				modelName: "Mistral Small",
			}).id,
		).toBe("default");
	});

	it("matches qwen by family token", () => {
		const profile = resolveChatModelProfile({
				modelId: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
				modelName: "Qwen3 Coder",
			});
		expect(profile.id).toBe("qwen");
		expect(profile.collapseSystemSections).toBe(true);
		expect(profile.insertToolGuidance).toBe(false);
	});

	it("matches openai-compatible local models by token", () => {
		const profile = resolveChatModelProfile({
				modelId: "lmstudio-community/gpt-oss-20b",
				modelName: "GPT OSS 20B",
			});
		expect(profile.id).toBe("openai");
		expect(profile.insertToolGuidance).toBe(true);
		expect(profile.insertThinkingGuidance).toBe(true);
	});

	it("matches gemma by family token", () => {
		const profile = resolveChatModelProfile({
				modelId: "google/gemma-3-27b-it",
				modelName: "Gemma 3 27B",
			});
		expect(profile.id).toBe("gemma");
		expect(profile.toolResultMode).toBe("user");
		expect(profile.httpRolePattern).toBe("alternatingUserAssistant");
	});
});
