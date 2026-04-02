import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";

import {
	coerceString,
	errorResult,
	summarizePathLike,
	textResult,
} from "./helpers";

export const notebookEditTool: ChatToolDefinition = {
	name: "NotebookEdit",
	source: "claude",
	category: "filesystem",
	uiKind: "input_output",
	description: [
		"Edit a Jupyter notebook (.ipynb) cell.",
		"Supports replacing, inserting, or deleting cells.",
		"Use cell_id to target a specific cell by its id or index (e.g. '0', '1', 'cell-2').",
		"For insert, the new cell is placed after the referenced cell.",
	].join(" "),
	inputSchema: {
		type: "object",
		properties: {
			notebook_path: {
				type: "string",
				description: "Absolute path to the .ipynb notebook file.",
			},
			cell_id: {
				type: "string",
				description: [
					"Cell identifier. Can be:",
					"  - A cell id string (e.g. the UUID in the notebook)",
					'  - A zero-based index as string (e.g. "0", "3")',
					'  - A "cell-N" form (e.g. "cell-2" → index 2)',
					"Required for replace and delete. For insert, omit to insert at the beginning.",
				].join("\n"),
			},
			new_source: {
				type: "string",
				description: "New cell source content. Required for replace and insert.",
			},
			cell_type: {
				type: "string",
				enum: ["code", "markdown"],
				description: 'Cell type. Required for insert operations. Defaults to "code" for replace.',
			},
			edit_mode: {
				type: "string",
				enum: ["replace", "insert", "delete"],
				description: 'Edit operation: "replace" (default), "insert" (after cell_id), or "delete".',
			},
		},
		required: ["notebook_path", "new_source"],
		additionalProperties: false,
	},
	readOnly: false,
	concurrencySafe: false,
	summarize(input) {
		return summarizePathLike(input.notebook_path);
	},
	async execute(input, context) {
		const notebookPath = coerceString(input.notebook_path);
		const newSource = coerceString(input.new_source);
		const rawCellId = coerceString(input.cell_id) || undefined;
		const cellType = (() => {
			const value = coerceString(input.cell_type);
			return value === "markdown" ? "markdown" : value === "code" ? "code" : undefined;
		})();
		const editMode = (() => {
			const value = coerceString(input.edit_mode, "replace");
			return value === "insert" || value === "delete" ? value : "replace";
		})();

		if (!notebookPath) {
			return errorResult("No notebook_path provided.");
		}
		if (!/\.ipynb$/i.test(notebookPath)) {
			return errorResult("NotebookEdit only works with .ipynb files. Use Edit for other files.");
		}
		if (editMode === "insert" && !cellType) {
			return errorResult("cell_type is required when inserting a new cell.");
		}

		// Resolve cell-N format: "cell-2" → "2"
		let cellId = rawCellId;
		if (cellId) {
			const cellNumMatch = /^cell-(\d+)$/.exec(cellId);
			if (cellNumMatch) {
				cellId = cellNumMatch[1];
			}
		}

		const updated = await context.writeNotebookCell({
			notebookPath,
			cellId,
			newSource,
			cellType,
			editMode,
		});

		const actionLabel =
			editMode === "insert"
				? `Inserted cell ${updated.editedCellId ?? ""}`.trim()
				: editMode === "delete"
					? `Deleted cell ${rawCellId ?? ""}`.trim()
					: `Replaced cell ${updated.editedCellId ?? rawCellId ?? ""}`.trim();

		return textResult(`${actionLabel} in ${notebookPath}`, {
			kind: "input_output",
			title: notebookPath,
			subtitle: actionLabel,
			input: JSON.stringify(
				{
					notebook_path: notebookPath,
					cell_id: rawCellId,
					cell_type: cellType,
					edit_mode: editMode,
				},
				null,
				2,
			),
			output: `${actionLabel}.`,
		});
	},
};
