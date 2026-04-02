import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";
import { computeContentDiffHunks } from "@/lib/chat/tools/diff-utils";

import {
	coerceBoolean,
	coerceString,
	errorResult,
	summarizePathLike,
	textResult,
} from "./helpers";

export const editTool: ChatToolDefinition = {
	name: "Edit",
	source: "claude",
	category: "filesystem",
	uiKind: "diff",
	description: "Edit file contents in place using exact string replacement.",
	inputSchema: {
		type: "object",
		properties: {
			file_path: {
				type: "string",
				description: "Absolute path to the file to edit.",
			},
			old_string: {
				type: "string",
				description: [
					"Exact text to find and replace. Must match the file contents precisely,",
					"including whitespace and indentation. If empty, the new_string is prepended",
					"to the file (or creates a new file). When Read output includes line-number",
					"prefixes, do NOT include them in old_string.",
				].join(" "),
			},
			new_string: {
				type: "string",
				description: [
					"Replacement text. Must be different from old_string.",
					"Set to empty string to delete the matched text.",
				].join(" "),
			},
			replace_all: {
				type: "boolean",
				description: "Replace all occurrences instead of requiring a unique match. Default false.",
			},
		},
		required: ["file_path", "old_string", "new_string"],
		additionalProperties: false,
	},
	readOnly: false,
	concurrencySafe: false,
	summarize(input) {
		return summarizePathLike(input.file_path);
	},
	async execute(input, context) {
		const filePath = coerceString(input.file_path);
		const oldString = coerceString(input.old_string);
		const newString = coerceString(input.new_string);
		const replaceAll = coerceBoolean(input.replace_all);

		if (!filePath) {
			return errorResult("No file_path provided.");
		}

		if (oldString === newString && oldString !== "") {
			return errorResult("old_string and new_string are identical. No changes needed.");
		}

		const result = await context.editFile(filePath, oldString, newString, replaceAll);

		if (result.replacements === 0) {
			return errorResult(result.error || `No matches found in ${filePath}.`, {
				kind: "input_output",
				title: filePath,
				input: JSON.stringify(
					{ file_path: filePath, old_string: oldString, replace_all: replaceAll },
					null,
					2,
				),
				output: result.error || "No exact matches found.",
				isError: true,
			});
		}

		const verb = result.action === "created" ? "Created" : "Edited";
		const detail = result.action === "created"
			? `Created file with ${result.content.length} characters.`
			: `${result.replacements} replacement${result.replacements === 1 ? "" : "s"} applied.`;

		if (result.originalContent !== undefined && result.action === "edited") {
			const { hunks, additions, deletions } = computeContentDiffHunks(
				result.originalContent,
				result.content,
			);
			return textResult(`${verb} ${filePath} (${detail})`, {
				kind: "diff",
				filePath,
				action: "edited",
				hunks,
				additions,
				deletions,
				originalContent: result.originalContent,
				modifiedContent: result.content,
			});
		}

		return textResult(`${verb} ${filePath} (${detail})`, {
			kind: "diff",
			filePath,
			action: result.action === "created" ? "created" : "edited",
			hunks: [],
			additions: result.content.split("\n").length,
			deletions: 0,
			modifiedContent: result.content,
		});
	},
};
