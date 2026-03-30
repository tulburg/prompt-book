import { describe, expect, it } from "vitest";

import {
	buildDocumentDiagnostics,
	buildDocumentHover,
	buildDocumentWordCompletions,
} from "@/lib/editor-extensions/extensions/document-tools.shared";
import { createEditorExtensionRegistry } from "@/lib/editor-extensions/registry";
import { documentToolsExtension } from "@/lib/editor-extensions/extensions/document-tools";

describe("editor extension registry", () => {
	it("matches extensions by language id", () => {
		const registry = createEditorExtensionRegistry([documentToolsExtension]);
		const markdownMatches = registry.getMatchingExtensions({
			getLanguageId: () => "markdown",
			uri: { path: "/workspace/notes.md" },
		});
		const rustMatches = registry.getMatchingExtensions({
			getLanguageId: () => "rust",
			uri: { path: "/workspace/lib.rs" },
		});

		expect(markdownMatches).toHaveLength(1);
		expect(markdownMatches[0]?.manifest.id).toBe("document-tools");
		expect(rustMatches).toHaveLength(0);
	});
});

describe("document tools helpers", () => {
	it("builds completion items from words in the current document", () => {
		const suggestions = buildDocumentWordCompletions(
			"monaco models monaco manager markdown model",
			"mo",
		);

		expect(suggestions.map((suggestion) => suggestion.label)).toContain("monaco");
		expect(suggestions.map((suggestion) => suggestion.label)).toContain("model");
	});

	it("builds diagnostics and hover metadata", () => {
		const markers = buildDocumentDiagnostics("const value = 1;   \n\tindented");
		const hover = buildDocumentHover("## Planning", 5);

		expect(markers).toHaveLength(2);
		expect(markers[0]?.message).toBe("Trailing whitespace");
		expect(markers[1]?.message).toBe("Tab indentation detected");
		expect(hover?.value).toContain("Markdown heading level 2");
	});
});
