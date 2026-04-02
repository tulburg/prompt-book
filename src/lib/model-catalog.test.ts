import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchModelCatalog } from "@/lib/model-catalog";

describe("model catalog", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("merges the curated Qwen 3.5 search results into the catalog", async () => {
		const fetchMock = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes("author=lmstudio-community")) {
				return Promise.resolve(
					new Response(
						JSON.stringify([
							{
								id: "lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-GGUF",
								downloads: 1200,
								tags: ["gguf", "text-generation"],
							},
						]),
					),
				);
			}
			if (url.includes("author=unsloth")) {
				return Promise.resolve(
					new Response(
						JSON.stringify([
							{
								id: "unsloth/Qwen3.5-9B-GGUF",
								downloads: 9999,
								tags: ["gguf", "qwen3.5", "text-generation"],
							},
						]),
					),
				);
			}
			return Promise.resolve(new Response(JSON.stringify([])));
		});

		vi.stubGlobal("fetch", fetchMock);

		const catalog = await fetchModelCatalog();

		expect(catalog.some((entry) => entry.id === "unsloth/Qwen3.5-9B-GGUF")).toBe(true);
		expect(catalog.some((entry) => entry.id === "lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-GGUF")).toBe(true);
	});

	it("filters out uncensored and vision-focused GGUF repositories", async () => {
		const fetchMock = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			if (!url.includes("author=lmstudio-community")) {
				return Promise.resolve(new Response(JSON.stringify([])));
			}
			return Promise.resolve(
				new Response(
					JSON.stringify([
						{
							id: "someone/Qwen3.5-9B-Uncensored-GGUF",
							downloads: 4000,
							tags: ["gguf", "qwen3.5", "uncensored"],
						},
						{
							id: "someone/Qwen3-VL-8B-Instruct-GGUF",
							downloads: 5000,
							tags: ["gguf", "vision-language-model"],
						},
						{
							id: "someone/Qwen3.5-9B-GGUF",
							downloads: 6000,
							tags: ["gguf", "qwen3.5", "text-generation"],
						},
					]),
				),
			);
		});

		vi.stubGlobal("fetch", fetchMock);

		const catalog = await fetchModelCatalog();

		expect(catalog.some((entry) => entry.id === "someone/Qwen3.5-9B-GGUF")).toBe(true);
		expect(catalog.some((entry) => entry.id === "someone/Qwen3.5-9B-Uncensored-GGUF")).toBe(false);
		expect(catalog.some((entry) => entry.id === "someone/Qwen3-VL-8B-Instruct-GGUF")).toBe(false);
	});
});
