import type { JsonObject, JsonValue } from "./tools/tool-types";

export type ParsedToolCall = {
	id?: string;
	name: string;
	input: JsonObject;
};

function normalizeParsedToolName(name: string): string {
	return name
		.trim()
		.replace(/^functions[._/-]?/i, "")
		.replace(/^functions_/i, "");
}

function parseScalarValue(value: string): JsonValue {
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) {
		return Number(trimmed);
	}
	if (/^(true|false)$/i.test(trimmed)) {
		return trimmed.toLowerCase() === "true";
	}
	return trimmed;
}

function parseNamedArguments(text: string): JsonObject {
	const args: JsonObject = {};
	const argRegex = /([A-Za-z0-9_]+)=("(.*?)"|[^\s]+)/g;
	for (const match of text.matchAll(argRegex)) {
		const key = match[1];
		const rawValue = match[3] ?? match[2] ?? "";
		if (!key) continue;
		args[key] = parseScalarValue(rawValue);
	}
	return args;
}

function isPlainObject(value: unknown): value is JsonObject {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function toParsedJsonEnvelopeCall(value: unknown): ParsedToolCall | undefined {
	if (!isPlainObject(value)) {
		return undefined;
	}

	const candidate = value as {
		tool?: unknown;
		name?: unknown;
		arguments?: unknown;
		args?: unknown;
		id?: unknown;
	};
	const name =
		typeof candidate.tool === "string"
			? candidate.tool
			: typeof candidate.name === "string"
				? candidate.name
				: undefined;
	const args = candidate.arguments ?? candidate.args;
	if (!name || !isPlainObject(args)) {
		return undefined;
	}

	return {
		id: typeof candidate.id === "string" ? candidate.id : undefined,
		name: normalizeParsedToolName(name),
		input: args,
	};
}

function parseJsonEnvelopeCalls(text: string): ParsedToolCall[] {
	const trimmed = text.trim();
	if (!trimmed) {
		return [];
	}

	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (Array.isArray(parsed)) {
			const calls = parsed
				.map((item) => toParsedJsonEnvelopeCall(item))
				.filter((call): call is ParsedToolCall => !!call);
			if (calls.length) {
				return calls;
			}
		} else if (isPlainObject(parsed)) {
			const inner = parsed.tool_call;
			if (isPlainObject(inner)) {
				const call = toParsedJsonEnvelopeCall(inner);
				if (call) {
					return [call];
				}
			}

			const call = toParsedJsonEnvelopeCall(parsed);
			if (call) {
				return [call];
			}
		}
	} catch {
		// Fall through to regex-based extraction.
	}

	const calls: ParsedToolCall[] = [];
	const regex =
		/\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/gi;
	for (const match of text.matchAll(regex)) {
		const rawName = match[1];
		const rawArguments = match[2];
		if (!rawName || !rawArguments) {
			continue;
		}
		try {
			const parsed = JSON.parse(rawArguments) as unknown;
			if (isPlainObject(parsed)) {
				calls.push({
					name: normalizeParsedToolName(rawName),
					input: parsed,
				});
			}
		} catch {
			// Ignore malformed JSON blocks.
		}
	}
	return calls;
}

function parseToolRequestBlockCalls(text: string): ParsedToolCall[] {
	const calls: ParsedToolCall[] = [];
	const blockRegex = /\[TOOL_REQUEST\]\s*([\s\S]*?)\s*\[END_TOOL_REQUEST\]/gi;
	for (const match of text.matchAll(blockRegex)) {
		const body = (match[1] ?? "").trim();
		if (!body) {
			continue;
		}
		try {
			const parsed = JSON.parse(body) as unknown;
			if (Array.isArray(parsed)) {
				for (const item of parsed) {
					const call = toParsedJsonEnvelopeCall(item);
					if (call) {
						calls.push(call);
					}
				}
			} else {
				const call = toParsedJsonEnvelopeCall(parsed);
				if (call) {
					calls.push(call);
				}
			}
		} catch {
			// Ignore malformed JSON blocks.
		}
	}
	return calls;
}

function parseCommentaryJsonCalls(text: string): ParsedToolCall[] {
	const calls: ParsedToolCall[] = [];
	const regex =
		/(?:assistant)?commentary\s+to=([A-Za-z0-9_.-]+?)\s*(?:json|code)\s*(\{[\s\S]*?\})(?=\s*(\n|$))/gi;
	for (const match of text.matchAll(regex)) {
		const rawName = match[1];
		const jsonText = match[2];
		if (!rawName || !jsonText) {
			continue;
		}
		try {
			const parsed = JSON.parse(jsonText) as unknown;
			if (isPlainObject(parsed)) {
				calls.push({
					name: normalizeParsedToolName(rawName),
					input: parsed,
				});
			}
		} catch {
			// Ignore malformed JSON blocks.
		}
	}
	return calls;
}

function parseFunctionXmlCalls(text: string): ParsedToolCall[] {
	const calls: ParsedToolCall[] = [];
	const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
	for (const toolCallMatch of text.matchAll(toolCallRegex)) {
		const toolCallBody = toolCallMatch[1] ?? "";
		const functionRegex = /<function=([^>\s]+)>\s*([\s\S]*?)\s*<\/function>/gi;
		for (const functionMatch of toolCallBody.matchAll(functionRegex)) {
			const rawName = functionMatch[1];
			const functionBody = functionMatch[2] ?? "";
			if (!rawName) {
				continue;
			}

			const args: JsonObject = {};
			const parameterRegex =
				/<parameter=([^>\s]+)>\s*([\s\S]*?)\s*<\/parameter>/gi;
			for (const parameterMatch of functionBody.matchAll(parameterRegex)) {
				const key = parameterMatch[1]?.trim();
				const value = parameterMatch[2]?.trim();
				if (!key || value === undefined) {
					continue;
				}
				args[key] = parseScalarValue(value);
			}

			calls.push({
				name: normalizeParsedToolName(rawName),
				input: args,
			});
		}
	}
	return calls;
}

function parseArgPairXmlCalls(text: string): ParsedToolCall[] {
	const calls: ParsedToolCall[] = [];
	const toolCallRegex = /<tool_call>\s*([\s\S]*?)(?=<tool_call>|$)/gi;
	for (const toolCallMatch of text.matchAll(toolCallRegex)) {
		const toolCallBody = toolCallMatch[1] ?? "";
		const toolName = toolCallBody.split(/<arg_key>/i)[0]?.trim();
		if (!toolName) {
			continue;
		}
		const args: JsonObject = {};
		const argPairRegex =
			/<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
		for (const argMatch of toolCallBody.matchAll(argPairRegex)) {
			const key = argMatch[1]?.trim();
			const value = argMatch[2]?.trim();
			if (!key || value === undefined) {
				continue;
			}
			args[key] = parseScalarValue(value);
		}
		calls.push({
			name: normalizeParsedToolName(toolName),
			input: args,
		});
	}
	return calls;
}

function parseParameterAndTagArgs(body: string, rawName: string): JsonObject {
	const args: JsonObject = {};
	const parameterRegex =
		/<parameter=([^>\s]+)>\s*([\s\S]*?)\s*<\/parameter>/gi;
	for (const parameterMatch of body.matchAll(parameterRegex)) {
		const key = parameterMatch[1]?.trim();
		const value = parameterMatch[2]?.trim();
		if (!key) {
			continue;
		}
		args[key] = parseScalarValue(value ?? "");
	}

	const argTagRegex = /<([A-Za-z0-9_]+)>\s*([\s\S]*?)\s*<\/\1>/gi;
	for (const argMatch of body.matchAll(argTagRegex)) {
		const key = argMatch[1]?.trim();
		const value = argMatch[2]?.trim();
		if (
			!key ||
			key.toLowerCase() === rawName.toLowerCase() ||
			key.toLowerCase() === "function"
		) {
			continue;
		}
		if (!(key in args)) {
			args[key] = parseScalarValue(value ?? "");
		}
	}

	return args;
}

function parseNestedTagXmlCalls(text: string): ParsedToolCall[] {
	const withIndex: Array<{ index: number; call: ParsedToolCall }> = [];

	const toolCallRegex = /<tool_call>\s*([\s\S]*?)(?=<tool_call>|$)/gi;
	let toolCallMatch: RegExpExecArray | null;
	while ((toolCallMatch = toolCallRegex.exec(text)) !== null) {
		const toolCallBody = toolCallMatch[1] ?? "";
		const functionNameMatch = /<function=([^>\s]+)>/i.exec(toolCallBody);
		const rawName =
			functionNameMatch?.[1] ??
			/<([A-Za-z0-9_.-]+)>/i.exec(toolCallBody)?.[1];
		if (!rawName) {
			continue;
		}
		withIndex.push({
			index: toolCallMatch.index,
			call: {
				name: normalizeParsedToolName(rawName),
				input: parseParameterAndTagArgs(toolCallBody, rawName),
			},
		});
	}

	const bareTagRegex = /<([A-Za-z0-9_.-]+)>\s*([\s\S]*?)(?=<tool_call>|$)/gi;
	let bareMatch: RegExpExecArray | null;
	while ((bareMatch = bareTagRegex.exec(text)) !== null) {
		const rawName = bareMatch[1];
		const body = bareMatch[2] ?? "";
		if (
			!rawName ||
			rawName.toLowerCase() === "tool_call" ||
			!/<parameter=/.test(body)
		) {
			continue;
		}
		const args = parseParameterAndTagArgs(body, rawName);
		if (Object.keys(args).length === 0) {
			continue;
		}
		withIndex.push({
			index: bareMatch.index,
			call: {
				name: normalizeParsedToolName(rawName),
				input: args,
			},
		});
	}

	withIndex.sort((left, right) => left.index - right.index);
	return withIndex.map((entry) => entry.call);
}

function parseNamedArgumentCalls(text: string): ParsedToolCall[] {
	const calls: ParsedToolCall[] = [];
	const regex =
		/(?:^|\n)\s*([A-Za-z0-9_.-]+)\s+((?:[A-Za-z0-9_]+=(?:"[^"]*"|[^\s]+)\s*)+)(?=\n|$)/g;
	for (const match of text.matchAll(regex)) {
		const rawName = match[1];
		const argumentText = match[2];
		if (!rawName || !argumentText) {
			continue;
		}
		const args = parseNamedArguments(argumentText);
		if (!Object.keys(args).length) {
			continue;
		}
		calls.push({
			name: normalizeParsedToolName(rawName),
			input: args,
		});
	}
	return calls;
}

type ToolCallPatternParser = {
	test: (text: string) => boolean;
	parse: (text: string) => ParsedToolCall[];
};

const parserPipeline: ToolCallPatternParser[] = [
	{
		test: (text) =>
			(/"tool"\s*:/.test(text) || /"tool_call"\s*:/.test(text)) &&
			/"arguments"\s*:/.test(text),
		parse: parseJsonEnvelopeCalls,
	},
	{
		test: (text) =>
			/(?:assistant)?commentary\s+to=/i.test(text) &&
			/(?:json|code)\s*\{/.test(text),
		parse: parseCommentaryJsonCalls,
	},
	{
		test: (text) => /\[TOOL_REQUEST\]/i.test(text) && /\[END_TOOL_REQUEST\]/i.test(text),
		parse: parseToolRequestBlockCalls,
	},
	{
		test: (text) => /<tool_call>/i.test(text) && /<function=/i.test(text),
		parse: parseFunctionXmlCalls,
	},
	{
		test: (text) =>
			/<tool_call>/i.test(text) &&
			/<arg_key>/i.test(text) &&
			/<arg_value>/i.test(text),
		parse: parseArgPairXmlCalls,
	},
	{
		test: (text) =>
			(/<tool_call>/i.test(text) && /<[A-Za-z0-9_.-]+>/.test(text)) ||
			/<[A-Za-z0-9_.-]+>\s*[\s\S]*?<parameter=/.test(text),
		parse: parseNestedTagXmlCalls,
	},
	{
		test: (text) => /(?:^|\n)\s*[A-Za-z0-9_.-]+\s+[A-Za-z0-9_]+=/.test(text),
		parse: parseNamedArgumentCalls,
	},
];

export function parseToolCallsFromText(text: string): ParsedToolCall[] {
	if (!text.trim()) {
		return [];
	}

	for (const parser of parserPipeline) {
		if (!parser.test(text)) {
			continue;
		}
		const calls = parser.parse(text);
		if (calls.length) {
			return calls;
		}
	}

	return [];
}

function looksLikeToolCallPrefix(text: string): boolean {
	const trimmed = text.trimStart();
	if (!trimmed) {
		return false;
	}

	return (
		/^<tool_call\b/i.test(trimmed) ||
		/^<function=[^>]+>/i.test(trimmed) ||
		/^<parameter=[^>]+>/i.test(trimmed) ||
		/^<arg_key>/i.test(trimmed) ||
		/^<arg_value>/i.test(trimmed) ||
		/^(?:assistant)?commentary\s+to=/i.test(trimmed) ||
		/^\[TOOL_REQUEST\]/i.test(trimmed) ||
		/^\{\s*"tool"\s*:/.test(trimmed) ||
		/^\{\s*"tool_call"\s*:/.test(trimmed) ||
		/^[A-Za-z0-9_.-]+\s+[A-Za-z0-9_]+=/.test(trimmed)
	);
}

export function shouldCaptureToolCallText(
	fragment: string,
	bufferedText = "",
): boolean {
	const candidate = `${bufferedText}${fragment}`;
	if (!candidate.trim()) {
		return false;
	}

	return looksLikeToolCallPrefix(candidate) || parserPipeline.some((parser) => parser.test(candidate));
}

export function mergeParsedToolCalls(
	structuredCalls: Array<{ id: string; name: string; input: JsonObject }>,
	parsedCalls: ParsedToolCall[],
): Array<{ id: string; name: string; input: JsonObject }> {
	if (!parsedCalls.length) {
		return structuredCalls;
	}

	const seen = new Set<string>();
	const merged: Array<{ id: string; name: string; input: JsonObject }> = [];

	for (const call of structuredCalls) {
		const key = `${call.name}\u0000${JSON.stringify(call.input ?? {})}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(call);
	}

	for (let index = 0; index < parsedCalls.length; index++) {
		const call = parsedCalls[index]!;
		const key = `${call.name}\u0000${JSON.stringify(call.input ?? {})}`;
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push({
			id: call.id?.trim() ? call.id : `parsed-tool-call-${index}`,
			name: call.name,
			input: call.input,
		});
	}

	return merged;
}
