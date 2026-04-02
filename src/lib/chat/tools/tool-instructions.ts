import type { ChatToolDefinition } from "./tool-types";

function formatToolList(tools: ChatToolDefinition[]): string[] {
	return tools.map((tool) => {
		const parameters = Object.keys(tool.inputSchema.properties ?? {});
		return `- ${tool.name}: ${tool.description}${parameters.length > 0 ? ` Parameters: ${parameters.join(", ")}` : ""}`;
	});
}

export function buildToolInstructionSections(tools: ChatToolDefinition[]): string[] {
	if (tools.length === 0) {
		return [];
	}

	return [
		[
			"# Tool Use Policy",
			"- Use tools only when they materially help answer or complete the request.",
			"- Prefer specialized tools over shell commands when both exist.",
			"- Prefer read/search tools before write tools unless the required change is already certain.",
			"- When a tool fails, explain the failure and adjust rather than repeating the same invalid call.",
		].join("\n"),
		["# Available Tools", ...formatToolList(tools)].join("\n"),
	];
}
