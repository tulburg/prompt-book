import type { ChatToolDefinition, JsonObject } from "@/lib/chat/tools/tool-types";

import { coerceString, errorResult, textResult } from "./helpers";

export const grepTool: ChatToolDefinition = {
	name: "Grep",
	source: "claude",
	category: "search",
	uiKind: "input_output",
	description: [
		"Search file contents using ripgrep (rg).",
		"Supports full regex syntax. Use this instead of bash grep/rg for searching code.",
		"Literal braces need escaping (use interface\\{\\} to find interface{} in Go).",
		"For cross-line patterns, enable multiline mode.",
	].join(" "),
	inputSchema: {
		type: "object",
		properties: {
			pattern: {
				type: "string",
				description: "Regular expression pattern to search for in file contents.",
			},
			path: {
				type: "string",
				description: "File or directory to search in. Defaults to the workspace root.",
			},
			glob: {
				type: "string",
				description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}"). Multiple patterns can be comma-separated.',
			},
			output_mode: {
				type: "string",
				enum: ["content", "files_with_matches", "count"],
				description: [
					'"content" shows matching lines with context (default for searching code).',
					'"files_with_matches" shows only file paths.',
					'"count" shows match counts per file.',
				].join(" "),
			},
			type: {
				type: "string",
				description: 'File type filter (e.g. "js", "py", "rust"). More efficient than glob for standard file types.',
			},
			context: {
				type: "integer",
				description: "Lines of context before and after each match. Takes precedence over -A/-B/-C.",
			},
			head_limit: {
				type: "integer",
				description: "Maximum number of results to return.",
			},
			offset: {
				type: "integer",
				description: "Skip the first N results for pagination.",
			},
			multiline: {
				type: "boolean",
				description: "Enable multiline mode for patterns that span multiple lines.",
			},
			"-A": {
				type: "integer",
				description: "Lines to show after each match.",
			},
			"-B": {
				type: "integer",
				description: "Lines to show before each match.",
			},
			"-C": {
				type: "integer",
				description: "Lines to show before and after each match.",
			},
			"-i": {
				type: "boolean",
				description: "Case insensitive search.",
			},
			"-n": {
				type: "boolean",
				description: "Show line numbers in content mode. Default true.",
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
		if (!pattern) {
			return errorResult("No search pattern provided.");
		}

		// Build the payload, applying context precedence: context > -C > -A/-B
		const payload: JsonObject = { ...input };
		if (typeof input.context === "number") {
			payload["-C"] = input.context;
			delete payload["-A"];
			delete payload["-B"];
		}
		delete payload.context;

		const result = await context.grep(payload);

		if (result.mode === "files_with_matches") {
			if (result.files.length === 0) {
				return textResult("No files matched.", {
					kind: "file_list",
					title: pattern,
					items: [],
					truncated: false,
				});
			}
			return textResult(result.files.join("\n"), {
				kind: "file_list",
				title: pattern,
				subtitle:
					[
						`${result.files.length} file${result.files.length === 1 ? "" : "s"}`,
						typeof result.appliedLimit === "number" ? `limit ${result.appliedLimit}` : undefined,
						typeof result.appliedOffset === "number" && result.appliedOffset > 0
							? `offset ${result.appliedOffset}`
							: undefined,
						result.truncated ? "(truncated)" : undefined,
					]
						.filter(Boolean)
						.join(" · ") || undefined,
				items: result.files,
				truncated: result.truncated,
			});
		}

		if (!result.output) {
			const msg = result.mode === "count" ? "No matches found." : "No matches found.";
			return textResult(msg, {
				kind: "input_output",
				title: pattern,
				input: JSON.stringify(payload, null, 2),
				output: msg,
			});
		}

		return textResult(result.output, {
			kind: "input_output",
			title: pattern,
			subtitle:
				[
					result.mode === "count" ? "Counts by file" : undefined,
					typeof result.appliedLimit === "number" ? `limit ${result.appliedLimit}` : undefined,
					typeof result.appliedOffset === "number" && result.appliedOffset > 0
						? `offset ${result.appliedOffset}`
						: undefined,
					result.truncated ? "(truncated)" : undefined,
				]
					.filter(Boolean)
					.join(" · ") || undefined,
			input: JSON.stringify(payload, null, 2),
			output: result.output,
		});
	},
};
