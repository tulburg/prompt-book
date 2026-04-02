import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";

import { coerceString, textResult } from "./helpers";

export const globTool: ChatToolDefinition = {
	name: "Glob",
	source: "claude",
	category: "search",
	uiKind: "file_list",
	description: [
		"Fast file pattern matching across the codebase.",
		"Returns matching file paths sorted by modification time.",
		"Use glob patterns like **/*.ts, src/**/*.test.js, etc.",
	].join(" "),
	inputSchema: {
		type: "object",
		properties: {
			pattern: {
				type: "string",
				description: [
					"Glob pattern to match files. Examples:",
					"  **/*.ts — all TypeScript files",
					"  src/**/*.test.js — test files under src/",
					"  *.json — JSON files in the root",
				].join("\n"),
			},
			path: {
				type: "string",
				description: "Absolute path to the directory to search in. Defaults to the workspace root.",
			},
			head_limit: {
				type: "integer",
				description: "Maximum number of results to return. Default 200.",
			},
			offset: {
				type: "integer",
				description: "Skip the first N results for pagination.",
			},
		},
		required: ["pattern"],
		additionalProperties: false,
	},
	readOnly: true,
	concurrencySafe: true,
	summarize(input) {
		return coerceString(input.pattern) || null;
	},
	async execute(input, context) {
		const pattern = coerceString(input.pattern);
		const root = coerceString(input.path) || undefined;
		const headLimit = typeof input.head_limit === "number" ? input.head_limit : undefined;
		const offset = typeof input.offset === "number" ? input.offset : undefined;
		const result = await context.glob(pattern, root, { headLimit, offset });

		if (result.items.length === 0) {
			return textResult("No files found.", {
				kind: "file_list",
				title: pattern,
				subtitle: root || undefined,
				items: [],
				truncated: false,
			});
		}

		const subtitle = [
			`${result.items.length} file${result.items.length === 1 ? "" : "s"}`,
			root ? `in ${root}` : undefined,
			result.truncated ? "(truncated)" : undefined,
		].filter(Boolean).join(" ");

		return textResult(result.items.join("\n"), {
			kind: "file_list",
			title: pattern,
			subtitle,
			items: result.items,
			truncated: result.truncated,
		});
	},
};
