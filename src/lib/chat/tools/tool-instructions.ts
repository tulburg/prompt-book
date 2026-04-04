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
		"- CRITICAL: Before using `Context` with `action: \"read\"`, call `Context` with `action: \"list\"` unless the context was already returned earlier in the session.",
		"- Never guess or invent context filenames for read operations. If a needed context is missing, create it with `Context` and `action: \"write\"`.",
		"- CRITICAL: From the provided context list, you must load at least 1 context with `Context` and `action: \"read\"` before proceeding.",
		"- If the list is empty or no existing context fits the current change, create one with `Context` and `action: \"write\"`, including a markdown filename like `codebase.md`, a title, a description, and a paragraph, then read it before continuing.",
		"- After every major change, add a paragraph record for future use with `Context` and `action: \"write\"`.",
		"- When a major change changes the scope of a context, update that context's title and description in the same `Context` write call.",
		"- CRITICAL: After you make project changes, update at least 1 affected context with `Context` and `action: \"write\"` before finishing.",
		"- Apply these context rules when working inside an Odex-managed target project.",
		"- Before exiting any session in an Odex-managed target project, automatically create any missing context you judge should exist for future work.",
		"- In an Odex-managed target project, do not ask the user for permission or confirmation before creating or updating context files when they are needed. Use best judgment and create them automatically.",
	];
}

function buildBlockPolicyLines(tools: ChatToolDefinition[]): string[] {
	const hasBlockTool = tools.some((tool) => tool.name === "Block");
	if (!hasBlockTool) {
		return [];
	}

	return [
		"- Use `Block` when block-level architecture or grouped file ownership is relevant. It is not always mandatory at the start.",
		"- CRITICAL: Before using `Block` with `read`, `read_context`, `read_diagram`, or `read_files`, call `Block` with `action: \"list\"` unless the block was already returned earlier in the session.",
		"- Never guess or invent block ids for read operations. If a needed block is missing, create it with `Block` and `action: \"write\"`.",
		"- Default to coarse-grained blocks around major subsystems or workflows. Only split into finer-grained blocks when a coarse block would be too broad to stay useful.",
		"- CRITICAL: After you make project changes, update at least 1 affected block with `Block` and `action: \"write\"` before finishing.",
		"- Updating a block means keeping its title, definition, files list, linked context, and diagram current. Update the diagram when the block flow changed.",
		"- Apply these block rules when working inside an Odex-managed target project.",
		"- Before exiting any session in an Odex-managed target project, automatically create any missing block you judge should exist for future work.",
		"- In an Odex-managed target project, do not ask the user for permission or granularity preferences before creating or updating blocks. Use best judgment and create them automatically.",
		"- `.odex/context` and `.odex/blocks` belong at the root of the Odex-managed target project, not automatically in the current repository.",
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
