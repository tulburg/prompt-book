import type { ChatToolDefinition } from "./tool-types";

function formatToolList(tools: ChatToolDefinition[]): string[] {
	return tools.map((tool) => {
		const parameters = Object.keys(tool.inputSchema.properties ?? {});
		return `- ${tool.name}: ${tool.description}${parameters.length > 0 ? ` Parameters: ${parameters.join(", ")}` : ""}`;
	});
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

	return [
		lines.join("\n"),
		["# Available Tools", ...formatToolList(tools)].join("\n"),
	];
}
