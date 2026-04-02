import type {
	ChatToolContext,
	ChatToolDefinition,
	ChatToolDisplay,
	ChatToolResult,
	JsonObject,
} from "@/lib/chat/tools/tool-types";

export function coerceString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

export function coerceBoolean(value: unknown, fallback = false): boolean {
	return typeof value === "boolean" ? value : fallback;
}

export function coerceNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function summarizePathLike(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function textResult(
	content: string,
	display?: ChatToolDisplay,
): ChatToolResult {
	return { content, display };
}

export function errorResult(
	content: string,
	display?: ChatToolDisplay,
): ChatToolResult {
	return { content, display, isError: true };
}

export function createUnsupportedTool(
	definition: Omit<ChatToolDefinition, "execute"> & {
		reason: string;
	},
): ChatToolDefinition {
	return {
		...definition,
		availability: () => ({ supported: false, reason: definition.reason }),
		async execute(_input: JsonObject, _context: ChatToolContext) {
			return errorResult(definition.reason, {
				kind: "text",
				title: definition.name,
				text: definition.reason,
			});
		},
	};
}
