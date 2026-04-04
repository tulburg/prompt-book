import { describe, expect, it } from "vitest";

import { buildEffectiveSystemPrompt } from "@/lib/chat/system-prompt";

describe("system prompt", () => {
	it("lets an override replace the default prompt stack", () => {
		expect(
			buildEffectiveSystemPrompt({
				mode: "Agent",
				overrideSystemPrompt: "custom override",
			}),
		).toEqual(["custom override"]);
	});
});
