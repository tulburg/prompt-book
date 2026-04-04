import type { ChatToolDefinition } from "./tool-types";

function formatToolList(tools: ChatToolDefinition[]): string[] {
	return tools.map((tool) => {
		const parameters = Object.keys(tool.inputSchema.properties ?? {});
		return `- ${tool.name}: ${tool.description}${parameters.length > 0 ? ` Parameters: ${parameters.join(", ")}` : ""}`;
	});
}

function buildContextPolicyLines(tools: ChatToolDefinition[]): string[] {
	const hasContextTool = tools.some((tool) => tool.name === "Context");
	if (!hasContextTool) {
		return [];
	}

	return [
		"- CRITICAL: Listing context is the first thing to do before any executions. Call `Context` with `action: \"list\"` before proceeding.",
		"- CRITICAL: From the provided context list, you must load at least 1 context with `Context` and `action: \"read\"` before proceeding.",
		"- If the list is empty or no existing context fits the current change, create one with `Context` and `action: \"write\"`, including a markdown filename like `codebase.md`, a title, a description, and a paragraph, then read it before continuing.",
		"- After every major change, add a paragraph record for future use with `Context` and `action: \"write\"`.",
		"- When a major change changes the scope of a context, update that context's title and description in the same `Context` write call.",
		"- Before exiting any session, automatically create any missing context you judge should exist for future work.",
		"- Do not ask the user for permission to create or update context files when they are needed. Use best judgment and create them automatically.",
	];
}

function buildBlockPolicyLines(tools: ChatToolDefinition[]): string[] {
	const hasBlockTool = tools.some((tool) => tool.name === "Block");
	if (!hasBlockTool) {
		return [];
	}

	return [
		"- Use `Block` when block-level architecture or grouped file ownership is relevant. It is not always mandatory at the start.",
		"- Default to coarse-grained blocks around major subsystems or workflows. Only split into finer-grained blocks when a coarse block would be too broad to stay useful.",
		"- CRITICAL: After you make project changes, update at least 1 affected block with `Block` and `action: \"write\"` before finishing.",
		"- Updating a block means keeping its title, definition, files list, linked context, and diagram current. Update the diagram when the block flow changed.",
		"- Before exiting any session, automatically create any missing block you judge should exist for future work.",
		"- Do not ask the user for permission or granularity preferences before creating or updating blocks. Use best judgment and create them automatically.",
		"- Treat `.odex/context` and `.odex/blocks` artifacts as normal project metadata. Do not ask whether they should be committed; only discuss commits if the user explicitly asks for a commit.",
	];
}

export function buildToolInstructionSections(
	tools: ChatToolDefinition[],
	options?: {
		includeThinkingGuidance?: boolean;
	},
): string[] {
	if (tools.length === 0) {
		const lines = ["# Tool Use Policy"];
		if (options?.includeThinkingGuidance) {
			lines.push(
				"- When you emit thinking or reasoning, start each block with a short markdown title on its own line like `**Inspecting cache flow**`.",
			);
			lines.push(
				"- After the title, include at least one short paragraph summarizing that thinking block. Never emit a title-only thinking block.",
			);
		}
		lines.push("- No callable tools are available for this request.");
		lines.push("- Do not emit tool calls. Respond directly to the user.");
		return [lines.join("\n")];
	}

	const lines = ["# Tool Use Policy"];
	if (options?.includeThinkingGuidance) {
		lines.push(
			"- When you emit thinking or reasoning, start each block with a short markdown title on its own line like `**Inspecting cache flow**`.",
		);
		lines.push(
			"- After the title, include at least one short paragraph summarizing that thinking block. Never emit a title-only thinking block.",
		);
	}
	lines.push(
		"- Use a tool call when the task requires an action instead of only describing the action.",
		"- CRITICAL: When not using native structured tool calls, emit tool calls using this exact JSON shape:",
		'  {"tool":"<tool_name>","arguments":{"<argument_name>":"<argument_value>"}}',
		"- Prefer specialized tools over shell commands when both exist.",
		"- Prefer read/search tools before write tools unless the required change is already certain.",
		"- When a tool fails, explain the failure and adjust rather than repeating the same invalid call.",
	);
	lines.push(...buildContextPolicyLines(tools));
	lines.push(...buildBlockPolicyLines(tools));

	return [
		lines.join("\n"),
		["# Available Tools", ...formatToolList(tools)].join("\n"),
	];
}
