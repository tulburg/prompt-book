/**
 * Integration test — hits the real llama-server at localhost:48123.
 * Mirrors exactly what the UI does: load model → build request → stream response.
 *
 * Run manually:  npx vitest run src/lib/chat/transports/llama-adapter.integration.test.ts
 */
import { describe, expect, it } from "vitest";

const SERVER_URL = "http://localhost:48123";
const QWEN_MODEL_ID = "bartowski/Qwen3-Coder-30B-A3B-Instruct-GGUF";

async function getModelStatus(modelId: string): Promise<string | null> {
	try {
		const res = await fetch(`${SERVER_URL}/models`, { signal: AbortSignal.timeout(4000) });
		if (!res.ok) return null;
		const payload = (await res.json()) as { data?: Array<{ id?: string; status?: { value?: string } }> };
		const match = (payload.data ?? []).find((m) => m.id === modelId);
		return match?.status?.value ?? null;
	} catch {
		return null;
	}
}

async function ensureModelLoaded(modelId: string): Promise<void> {
	const status = await getModelStatus(modelId);
	console.log(`[integration] initial status for ${modelId}: ${status}`);

	if (status === "loaded") return;

	const loadRes = await fetch(`${SERVER_URL}/models/load`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ model: modelId }),
	});
	console.log(`[integration] POST /models/load → ${loadRes.status}`);

	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 2000));
		const s = await getModelStatus(modelId);
		console.log(`[integration] poll status: ${s}`);
		if (s === "loaded") return;
		if (s === "unloaded") throw new Error("Model failed to load");
	}
	throw new Error("Timed out waiting for model to load");
}

describe("llama-server integration (requires running server)", () => {
	it("sends a message to Qwen via the real server and gets a coherent response", async () => {
		// Step 1: check server is reachable
		let serverUp = false;
		try {
			const healthRes = await fetch(`${SERVER_URL}/models`, { signal: AbortSignal.timeout(3000) });
			serverUp = healthRes.ok;
		} catch { /* skip */ }

		if (!serverUp) {
			console.log("[integration] Server not running at", SERVER_URL, "— skipping");
			return;
		}

		// Step 2: load the model (same as ChatPanel.handleSelectModel)
		await ensureModelLoaded(QWEN_MODEL_ID);

		// Step 3: build the exact same payload the app sends
		const payload = {
			model: QWEN_MODEL_ID,
			messages: [
				{
					role: "system",
					content: [
						"# Identity",
						"You are a local coding assistant inside Prompt Book.",
						"Your job is to help with software tasks clearly, accurately, and with minimal unnecessary changes.",
						"",
						"# Response Contract",
						"- Keep answers direct and technically precise.",
						"",
						"# Mode: Agent",
						"Default to taking action for implementation-oriented requests.",
						"",
						"# Runtime Context",
						`- date: ${new Date().toISOString()}`,
						`- model: ${QWEN_MODEL_ID}`,
						"",
						"# User Context",
						"- mode: Agent",
						"- platform: darwin",
					].join("\n"),
				},
				{
					role: "user",
					content: "Say hello in one sentence.",
				},
			],
			stream: true,
			temperature: 0.7,
			stop: ["<|im_end|>", "<|endoftext|>"],
		};

		console.log("[integration] Sending request to", `${SERVER_URL}/v1/chat/completions`);
		console.log("[integration] Payload:", JSON.stringify(payload, null, 2));

		// Step 4: send the request (same as LlamaChatAdapter.stream)
		const response = await fetch(`${SERVER_URL}/v1/chat/completions`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		console.log("[integration] Response status:", response.status);
		console.log("[integration] Response content-type:", response.headers.get("content-type"));

		expect(response.ok).toBe(true);

		const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
		let fullContent = "";

		if (contentType.includes("text/event-stream") && response.body) {
			// SSE streaming — same parsing as llama-adapter.ts
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			let frameCount = 0;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

				while (true) {
					const boundary = buffer.indexOf("\n\n");
					if (boundary === -1) break;

					const eventBlock = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const data = eventBlock
						.split("\n")
						.filter((line: string) => line.startsWith("data:"))
						.map((line: string) => line.slice(5).trimStart())
						.join("\n")
						.trim();

					if (!data || data === "[DONE]") continue;

					frameCount++;
					if (frameCount <= 15) {
						console.log(`[integration] SSE frame #${frameCount}:`, data);
					}

					try {
						const parsed = JSON.parse(data) as {
							choices?: Array<{
								delta?: { content?: string; role?: string };
							}>;
						};
						for (const choice of parsed.choices ?? []) {
							if (typeof choice.delta?.content === "string") {
								fullContent += choice.delta.content;
							}
						}
					} catch (e) {
						console.log(`[integration] Failed to parse SSE frame:`, e);
					}
				}
			}

			console.log(`[integration] Total SSE frames: ${frameCount}`);
		} else {
			// Non-streaming JSON
			const json = (await response.json()) as {
				choices?: Array<{ message?: { content?: string } }>;
			};
			console.log("[integration] JSON response:", JSON.stringify(json, null, 2));
			fullContent = json.choices?.[0]?.message?.content ?? "";
		}

		console.log("[integration] Full model output:", JSON.stringify(fullContent));
		console.log("[integration] Output length:", fullContent.length);
		console.log("[integration] First 200 chars:", fullContent.slice(0, 200));

		// Verify: model should produce actual text, not @@@@ garbage
		expect(fullContent.length).toBeGreaterThan(0);

		const atSignRatio = (fullContent.match(/@/g) ?? []).length / fullContent.length;
		console.log("[integration] @ ratio:", atSignRatio);
		expect(atSignRatio).toBeLessThan(0.5);
	}, 180_000);
});
