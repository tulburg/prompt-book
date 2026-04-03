import { describe, expect, it } from "vitest";

import {
	buildEffectiveSystemPrompt,
	SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
} from "@/lib/chat/system-prompt";

describe("system prompt", () => {
	it("builds a layered prompt with a dynamic boundary and mode block", () => {
		const prompt = buildEffectiveSystemPrompt({ mode: "Ask" });

		expect(prompt).toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
		expect(prompt.join("\n")).toContain("# Mode: Ask");
		expect(prompt[0]).toContain("# Identity");
	});

	it("lets an override replace the default prompt stack", () => {
		expect(
			buildEffectiveSystemPrompt({
				mode: "Agent",
				overrideSystemPrompt: "custom override",
			}),
		).toEqual(["custom override"]);
	});
});
