import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";
import { computeContentDiffHunks } from "@/lib/chat/tools/diff-utils";

import { coerceString, errorResult, summarizePathLike, textResult } from "./helpers";

export const writeTool: ChatToolDefinition = {
	name: "Write",
	source: "claude",
	category: "filesystem",
	uiKind: "diff",
	description: [
		"Create a new file or completely replace an existing file's contents.",
		"Prefer the Edit tool for making targeted changes to existing files.",
		"Use Write only for new files or complete rewrites.",
		"Do not create documentation files (*.md, README) unless explicitly requested.",
	].join(" "),
	inputSchema: {
		type: "object",
		properties: {
			file_path: {
				type: "string",
				description: "Absolute path to the file to create or overwrite.",
			},
			content: {
				type: "string",
				description: "Complete file contents to write. For existing files, this replaces the entire content.",
			},
		},
		required: ["file_path", "content"],
		additionalProperties: false,
	},
	readOnly: false,
	concurrencySafe: false,
	summarize(input) {
		return summarizePathLike(input.file_path);
	},
	async execute(input, context) {
		const filePath = coerceString(input.file_path);
		const content = coerceString(input.content);

		if (!filePath) {
			return errorResult("No file_path provided.");
		}

		const result = await context.writeFile(filePath, content);
		const verb = result.action === "created" ? "Created" : "Overwrote";
		const lineCount = content.split("\n").length;

		if (result.action === "overwritten" && result.originalContent !== undefined) {
			const { hunks, additions, deletions } = computeContentDiffHunks(
				result.originalContent,
				content,
			);
			return textResult(`${verb} ${filePath} (${content.length} chars, ${lineCount} lines)`, {
				kind: "diff",
				filePath,
				action: "overwritten",
				hunks,
				additions,
				deletions,
				originalContent: result.originalContent,
				modifiedContent: content,
			});
		}

		return textResult(`${verb} ${filePath} (${content.length} chars, ${lineCount} lines)`, {
			kind: "diff",
			filePath,
			action: "created",
			hunks: [],
			additions: lineCount,
			deletions: 0,
			modifiedContent: content,
		});
	},
};
