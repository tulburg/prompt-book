import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";

import { coerceNumber, coerceString, errorResult, summarizePathLike, textResult } from "./helpers";

const DANGEROUS_PATHS = [
	"/dev/zero", "/dev/null", "/dev/random", "/dev/urandom",
	"/dev/tty", "/dev/stdin", "/dev/stdout", "/dev/stderr",
];

export const readTool: ChatToolDefinition = {
	name: "Read",
	source: "claude",
	category: "filesystem",
	uiKind: "input_output",
	description: "Read a file from the local filesystem.",
	inputSchema: {
		type: "object",
		properties: {
			file_path: {
				type: "string",
				description: [
					"Absolute path to the file to read.",
					"For directories, use Bash with `ls` instead.",
				].join(" "),
			},
			offset: {
				type: "integer",
				description: [
					"Line number to start reading from (1-based).",
					"Negative values count from the end of the file (e.g. -10 reads the last 10 lines).",
					"Defaults to 1 (beginning of file).",
				].join(" "),
			},
			limit: {
				type: "integer",
				description: [
					"Number of lines to read. When omitted, reads up to 2000 lines.",
					"Use offset and limit to read specific portions of large files.",
				].join(" "),
			},
		},
		required: ["file_path"],
		additionalProperties: false,
	},
	readOnly: true,
	concurrencySafe: true,
	summarize(input) {
		return summarizePathLike(input.file_path);
	},
	async execute(input, context) {
		const filePath = coerceString(input.file_path);
		if (!filePath) {
			return errorResult("No file_path provided.");
		}

		if (DANGEROUS_PATHS.some((p) => filePath.startsWith(p))) {
			return errorResult(`Cannot read device path: ${filePath}`);
		}

		const offset = input.offset === undefined ? undefined : coerceNumber(input.offset, 1);
		const limit = input.limit === undefined ? undefined : coerceNumber(input.limit, 2000);

		if (limit !== undefined && limit < 1) {
			return errorResult("limit must be at least 1.");
		}

		let result;
		try {
			result = await context.readFile(filePath, { offset, limit });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/ENOENT|exist|not found|no such file/i.test(message)) {
				return errorResult(`File not found: ${filePath}`);
			}
			throw error;
		}

		if (result.unsupportedMessage) {
			return textResult(result.unsupportedMessage, {
				kind: "input_output",
				title: filePath,
				subtitle: `Unsupported ${result.fileType} file`,
				input: JSON.stringify({ file_path: filePath, offset, limit }, null, 2),
				output: result.unsupportedMessage,
				isError: true,
			});
		}

		if (result.totalLines === 0) {
			return textResult("File is empty.", {
				kind: "input_output",
				title: filePath,
				subtitle: "Empty file",
				input: JSON.stringify({ file_path: filePath }, null, 2),
				output: "File is empty.",
			});
		}

		const lines = result.content.split("\n");
		const numbered = lines
			.map((line, index) => {
				const lineNum = String(result.startLine + index).padStart(6, " ");
				return `${lineNum}|${line}`;
			})
			.join("\n");

		const subtitleParts = [
			result.fileType === "notebook" ? "Notebook JSON" : undefined,
			result.truncated
				? `Lines ${result.startLine}–${result.endLine} of ${result.totalLines}`
				: `${result.totalLines} lines`,
		].filter(Boolean);

		return textResult(numbered, {
			kind: "input_output",
			title: filePath,
			subtitle: subtitleParts.join(" · ") || undefined,
			input: JSON.stringify({ file_path: filePath, offset, limit }, null, 2),
			output: numbered,
		});
	},
};
