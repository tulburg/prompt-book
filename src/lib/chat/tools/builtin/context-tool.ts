import type { ChatToolDefinition, JsonObject } from "@/lib/chat/tools/tool-types";

import { coerceString, errorResult, textResult } from "./helpers";

type ContextToolInput = JsonObject & {
	action?: "list" | "read" | "write";
	filename?: string;
	title?: string;
	description?: string;
	paragraph?: string;
};

export const contextTool: ChatToolDefinition<ContextToolInput> = {
	name: "Context",
	source: "claude",
	category: "filesystem",
	uiKind: "file_list",
	description: [
		"List, read, and write persistent project context records.",
		"Context files live in .odex/context under the current project.",
		"Use list before execution, read at least one relevant context, and write back after major changes.",
	].join(" "),
	inputSchema: {
		type: "object",
		properties: {
			action: {
				type: "string",
				enum: ["list", "read", "write"],
				description: "Which context operation to perform.",
			},
			filename: {
				type: "string",
				description: "Markdown filename inside .odex/context, for example codebase.md.",
			},
			title: {
				type: "string",
				description: "Context title. Required when creating a new context and optional when updating one.",
			},
			description: {
				type: "string",
				description: "Short context description. Required when creating a new context and optional when updating one.",
			},
			paragraph: {
				type: "string",
				description: "Paragraph to append for future context. Required for write.",
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
		const filename = coerceString(input.filename);
		return [action, filename].filter(Boolean).join(" ").trim() || "context";
	},
	async execute(input, context) {
		const action = coerceString(input.action);

		if (action === "list") {
			const items = await context.listContexts();
			if (items.length === 0) {
				return textResult("No context files found in .odex/context.", {
					kind: "file_list",
					title: ".odex/context",
					subtitle: "0 contexts",
					items: [],
				});
			}

			const output = items
				.map((item) => `${item.filename} - ${item.title}${item.description ? `: ${item.description}` : ""}`)
				.join("\n");
			return textResult(output, {
				kind: "file_list",
				title: ".odex/context",
				subtitle: `${items.length} context${items.length === 1 ? "" : "s"}`,
				items: items.map((item) => ({
					value: item.filename,
					title: item.title,
					description: item.description,
					metadata: new Date(item.updatedAt).toISOString(),
				})),
			});
		}

		if (action === "read") {
			const filename = coerceString(input.filename);
			if (!filename) {
				return errorResult("Context read requires filename.");
			}
			const result = await context.readContext(filename);
			return textResult(result.content, {
				kind: "input_output",
				title: result.filename,
				subtitle: result.title,
				input: JSON.stringify({ action, filename }, null, 2),
				output: result.content,
			});
		}

		if (action === "write") {
			const filename = coerceString(input.filename);
			const paragraph = coerceString(input.paragraph);
			if (!filename) {
				return errorResult("Context write requires filename.");
			}
			if (!paragraph.trim()) {
				return errorResult("Context write requires paragraph.");
			}
			const result = await context.writeContext({
				filename,
				title: coerceString(input.title) || undefined,
				description: coerceString(input.description) || undefined,
				paragraph,
			});
			return textResult(
				`${result.action === "created" ? "Created" : "Updated"} context ${result.filename}.`,
				{
					kind: "input_output",
					title: result.filename,
					subtitle: `${result.action} · ${result.title}`,
					input: JSON.stringify(
						{
							action,
							filename,
							title: input.title,
							description: input.description,
							paragraph,
						},
						null,
						2,
					),
					output: result.content,
				},
			);
		}

		return errorResult(`Unknown context action: ${action || "(empty)"}`);
	},
};
