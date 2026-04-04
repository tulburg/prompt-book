import type { ChatToolDefinition, JsonObject } from "@/lib/chat/tools/tool-types";

import { coerceString, errorResult, textResult } from "./helpers";

type BlockToolInput = JsonObject & {
	action?: "list" | "read" | "read_context" | "read_diagram" | "read_files" | "write";
	block_id?: string;
	title?: string;
	definition?: string;
	files?: string[];
	diagram_filename?: string;
	diagram_content?: string;
	context_filename?: string;
	context_title?: string;
	context_description?: string;
	context_body?: string;
};

function formatNumberedContent(content: string, startLine = 1): string {
	const lines = content.split("\n");
	return lines
		.map((line, index) => `${String(startLine + index).padStart(6, " ")}|${line}`)
		.join("\n");
}

export const blockTool: ChatToolDefinition<BlockToolInput> = {
	name: "Block",
	source: "claude",
	category: "filesystem",
	uiKind: "json",
	description: [
		"List, inspect, and update project blocks stored in .odex/blocks.",
		"Blocks describe a project feature or workflow with its definition, files, diagram, and linked context.",
		"Block write can also update the linked context when you provide context metadata and context_body.",
		"Decide blocks from actual code behavior and feature boundaries, not from folder structure alone.",
		"Use write to create a missing block; do not use read actions for blocks that are not listed yet.",
		"After project modifications, update at least one affected block.",
	].join(" "),
	inputSchema: {
		type: "object",
		properties: {
			action: {
				type: "string",
				enum: ["list", "read", "read_context", "read_diagram", "read_files", "write"],
				description: 'Which block operation to perform. Use "list" before reads. Use "write" to create or update blocks.',
			},
			block_id: {
				type: "string",
				description: 'Block identifier, usually the block folder name under .odex/blocks. For new blocks, provide the desired id with action "write".',
			},
			title: {
				type: "string",
				description: "Updated block title.",
			},
			definition: {
				type: "string",
				description: "Updated block definition.",
			},
			files: {
				type: "array",
				items: { type: "string" },
				description: "Absolute file paths that belong to the block.",
			},
			diagram_filename: {
				type: "string",
				description: "Diagram filename within the block folder. Defaults to diagram.mmd.",
			},
			diagram_content: {
				type: "string",
				description: "Mermaid diagram content to write when the diagram changes.",
			},
			context_filename: {
				type: "string",
				description: "Context markdown filename in .odex/context.",
			},
			context_title: {
				type: "string",
				description: "Updated linked-context title.",
			},
			context_description: {
				type: "string",
				description: "Updated linked-context description.",
			},
			context_body: {
				type: "string",
				description: "Full replacement body for the linked context map. Point-by-point pointers describing where things are and what they do. Overwrites previous content.",
			},
		},
		required: ["action"],
		additionalProperties: false,
	},
	readOnly(input) {
		return input.action !== "write";
	},
	concurrencySafe(input) {
		return input.action !== "write";
	},
	summarize(input) {
		const action = coerceString(input.action);
		const blockId = coerceString(input.block_id);
		return [action, blockId].filter(Boolean).join(" ").trim() || "block";
	},
	async execute(input, context) {
		const action = coerceString(input.action);

		if (action === "list") {
			const items = await context.listBlocks();
			if (items.length === 0) {
				return textResult('No blocks found in .odex/blocks. Use Block with action "write" to create the first block.', {
					kind: "file_list",
					title: ".odex/blocks",
					subtitle: "0 blocks",
					items: [],
				});
			}
			return textResult(
				items
					.map((item) => `${item.id} - ${item.title}: ${item.definition}`)
					.join("\n"),
				{
					kind: "file_list",
					title: ".odex/blocks",
					subtitle: `${items.length} block${items.length === 1 ? "" : "s"}`,
					items: items.map((item) => ({
						value: item.id,
						title: item.title,
						description: item.definition,
						metadata: `${item.files.length} files`,
					})),
				},
			);
		}

		const blockId = coerceString(input.block_id);
		if (!blockId) {
			return errorResult(`Block action "${action}" requires block_id.`);
		}

		if (action === "read") {
			const block = await context.readBlock(blockId);
			const value = {
				id: block.id,
				title: block.title,
				definition: block.definition,
				files: block.files,
				diagramPath: block.diagramPath,
				contextPath: block.contextPath,
				schemaPath: block.schemaPath,
			};
			return textResult(JSON.stringify(value, null, 2), {
				kind: "json",
				title: block.id,
				value,
			});
		}

		if (action === "read_context" || action === "read_diagram" || action === "read_files") {
			const block = await context.readBlock(blockId);

			if (action === "read_context") {
				const result = await context.readFile(block.contextPath);
				return textResult(formatNumberedContent(result.content, result.startLine), {
					kind: "input_output",
					title: `${block.id} context`,
					subtitle: block.contextPath,
					input: JSON.stringify({ action, block_id: blockId }, null, 2),
					output: formatNumberedContent(result.content, result.startLine),
				});
			}

			if (action === "read_diagram") {
				const result = await context.readFile(block.diagramPath);
				return textResult(formatNumberedContent(result.content, result.startLine), {
					kind: "input_output",
					title: `${block.id} diagram`,
					subtitle: block.diagramPath,
					input: JSON.stringify({ action, block_id: blockId }, null, 2),
					output: formatNumberedContent(result.content, result.startLine),
				});
			}

			// action === "read_files"
			const contents = await Promise.all(
				block.files.map(async (filePath) => {
					const result = await context.readFile(filePath);
					return [`=== ${filePath} ===`, formatNumberedContent(result.content, result.startLine)].join("\n");
				}),
			);
			const output = contents.join("\n\n");
			return textResult(output, {
				kind: "input_output",
				title: `${block.id} files`,
				subtitle: `${block.files.length} file${block.files.length === 1 ? "" : "s"}`,
				input: JSON.stringify({ action, block_id: blockId }, null, 2),
				output,
			});
		}

		if (action === "write") {
			const rawFiles = Array.isArray(input.files)
				? input.files.filter((value): value is string => typeof value === "string")
				: undefined;
			const result = await context.writeBlock({
				blockId,
				title: coerceString(input.title) || undefined,
				definition: coerceString(input.definition) || undefined,
				files: rawFiles,
				diagramFilename: coerceString(input.diagram_filename) || undefined,
				diagramContent: coerceString(input.diagram_content) || undefined,
				contextFilename: coerceString(input.context_filename) || undefined,
				contextTitle: coerceString(input.context_title) || undefined,
				contextDescription: coerceString(input.context_description) || undefined,
				contextBody: coerceString(input.context_body),
			});
			const value = {
				id: result.id,
				title: result.title,
				definition: result.definition,
				files: result.files,
				diagramPath: result.diagramPath,
				contextPath: result.contextPath,
				schemaPath: result.schemaPath,
				action: result.action,
			};
			return textResult(`${result.action === "created" ? "Created" : "Updated"} block ${result.id}.`, {
				kind: "json",
				title: result.id,
				value,
			});
		}

		return errorResult(`Unknown block action: ${action || "(empty)"}`);
	},
};
