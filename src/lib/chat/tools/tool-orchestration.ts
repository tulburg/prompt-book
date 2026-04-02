import { findToolByName } from "./tool-registry";
import { executeToolCall, type ExecutedToolCall } from "./tool-execution";
import type { ChatToolCall, ChatToolContext } from "./tool-types";

function isConcurrencySafe(
	value: boolean | ((input: ChatToolCall["input"]) => boolean),
	input: ChatToolCall["input"],
): boolean {
	return typeof value === "function" ? value(input) : value;
}

export async function executeToolCalls(
	calls: ChatToolCall[],
	context: ChatToolContext,
): Promise<ExecutedToolCall[]> {
	const results: ExecutedToolCall[] = [];
	let batch: ChatToolCall[] = [];

	async function flushBatch() {
		if (batch.length === 0) return;
		if (batch.length === 1) {
			results.push(await executeToolCall(batch[0]!, context));
			batch = [];
			return;
		}
		const executed = await Promise.all(batch.map((call) => executeToolCall(call, context)));
		results.push(...executed);
		batch = [];
	}

	for (const call of calls) {
		const tool = findToolByName(call.name);
		if (!tool || !isConcurrencySafe(tool.concurrencySafe, call.input)) {
			await flushBatch();
			results.push(await executeToolCall(call, context));
			continue;
		}
		batch.push(call);
	}

	await flushBatch();
	return results;
}
