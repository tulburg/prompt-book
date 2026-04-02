import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";

import { coerceString, errorResult, textResult } from "./helpers";

export const webSearchTool: ChatToolDefinition = {
	name: "WebSearch",
	source: "claude",
	category: "web",
	uiKind: "file_list",
	description: [
		"Search the web for real-time information.",
		"Use when you need up-to-date information not available in your training data,",
		"or when you need to verify current facts about libraries, APIs, or events.",
	].join(" "),
	inputSchema: {
		type: "object",
		properties: {
			query: {
				type: "string",
				description: "Search query. Be specific and include relevant keywords. Include version numbers or dates when relevant.",
			},
			explanation: {
				type: "string",
				description: "Brief explanation of why this search is needed.",
			},
			allowed_domains: {
				type: "array",
				description: "Only include results from these domains. Cannot be used with blocked_domains.",
				items: { type: "string" },
			},
			blocked_domains: {
				type: "array",
				description: "Exclude results from these domains. Cannot be used with allowed_domains.",
				items: { type: "string" },
			},
		},
		required: ["query"],
		additionalProperties: false,
	},
	readOnly: true,
	concurrencySafe: true,
	summarize(input) {
		return coerceString(input.query) || null;
	},
	async execute(input, context) {
		const query = coerceString(input.query);
		const explanation = coerceString(input.explanation) || undefined;

		if (!query || query.length < 2) {
			return errorResult("Search query must be at least 2 characters.");
		}

		const allowedDomains = Array.isArray(input.allowed_domains)
			? input.allowed_domains.filter((value): value is string => typeof value === "string")
			: undefined;
		const blockedDomains = Array.isArray(input.blocked_domains)
			? input.blocked_domains.filter((value): value is string => typeof value === "string")
			: undefined;

		if (allowedDomains?.length && blockedDomains?.length) {
			return errorResult("Cannot specify both allowed_domains and blocked_domains. Use one or the other.");
		}

		const results = await context.searchWeb({
			query,
			explanation,
			allowedDomains,
			blockedDomains,
		});

		if (results.length === 0) {
			return textResult("No results found.", {
				kind: "file_list",
				title: query,
				subtitle: explanation,
				items: [],
			});
		}

		const output = results
			.map((item) => `${item.title}\n${item.url}\n${item.snippet}`.trim())
			.join("\n\n");

		return textResult(output, {
			kind: "file_list",
			title: query,
			subtitle: explanation || `${results.length} result${results.length === 1 ? "" : "s"}`,
			items: results.map((item) => ({
				value: item.url,
				title: item.title,
				description: item.snippet,
			})),
		});
	},
};
