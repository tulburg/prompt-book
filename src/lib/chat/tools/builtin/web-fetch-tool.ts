import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";

import { coerceString, errorResult, textResult } from "./helpers";

function isValidUrl(url: string): { valid: boolean; reason?: string } {
	try {
		const parsed = new URL(url);
		if (!["http:", "https:"].includes(parsed.protocol)) {
			return { valid: false, reason: `Unsupported protocol: ${parsed.protocol}` };
		}
		if (parsed.username || parsed.password) {
			return { valid: false, reason: "URLs with embedded credentials are not supported." };
		}
		const hostname = parsed.hostname.toLowerCase();
		if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1") {
			return { valid: false, reason: "localhost and loopback URLs are not supported." };
		}
		return { valid: true };
	} catch {
		return { valid: false, reason: "Invalid URL format." };
	}
}

export const webFetchTool: ChatToolDefinition = {
	name: "WebFetch",
	source: "claude",
	category: "web",
	uiKind: "input_output",
	description: [
		"Fetch content from a URL and return it in readable format.",
		"HTML pages are converted to readable text.",
		"Prefer this for documentation, API references, and web content.",
		"For GitHub-specific data, prefer using the gh CLI via Bash instead.",
	].join(" "),
	inputSchema: {
		type: "object",
		properties: {
			url: {
				type: "string",
				description: "Fully qualified URL to fetch (must start with http:// or https://).",
			},
			prompt: {
				type: "string",
				description: "What to focus on or extract from the page content.",
			},
		},
		required: ["url", "prompt"],
		additionalProperties: false,
	},
	readOnly: true,
	concurrencySafe: true,
	summarize(input) {
		return coerceString(input.url) || null;
	},
	async execute(input, context) {
		let url = coerceString(input.url);
		const prompt = coerceString(input.prompt);

		if (!url) {
			return errorResult("No url provided.");
		}

		// Upgrade http to https
		if (url.startsWith("http://")) {
			url = `https://${url.slice(7)}`;
		}

		const validation = isValidUrl(url);
		if (!validation.valid) {
			return errorResult(validation.reason || "Invalid URL.");
		}

		const result = await context.fetchUrl({ url, prompt });

		const subtitle = [
			String(result.status),
			result.contentType.split(";")[0]?.trim(),
			result.bytes > 0 ? `${Math.round(result.bytes / 1024)}KB` : undefined,
		].filter(Boolean).join(" · ");

		return textResult(result.result, {
			kind: "input_output",
			title: url,
			subtitle,
			input: JSON.stringify({ url, prompt }, null, 2),
			output: result.result,
		});
	},
};
