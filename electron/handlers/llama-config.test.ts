import { describe, expect, it } from "vitest";

import { buildLlamaServerArgs } from "./llama-config";

describe("llama server config", () => {
	it("starts the local server with chat-safe defaults", () => {
		expect(
			buildLlamaServerArgs({
				port: "48123",
				localModelsDir: "/tmp/models",
			}),
		).toEqual([
			"--host",
			"127.0.0.1",
			"--port",
			"48123",
			"--jinja",
			"--reasoning-format",
			"deepseek",
			"--no-prefill-assistant",
			"--models-dir",
			"/tmp/models",
		]);
	});
});
