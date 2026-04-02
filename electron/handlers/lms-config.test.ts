import { describe, expect, it } from "vitest";

import { buildLlamaServerArgs } from "./lms-config";

describe("llama server config", () => {
	it("starts the local server with chat-safe defaults", () => {
		expect(
			buildLlamaServerArgs({
				port: "8123",
				localModelsDir: "/tmp/models",
			}),
		).toEqual([
			"--host",
			"127.0.0.1",
			"--port",
			"8123",
			"--jinja",
			"--reasoning-format",
			"none",
			"--no-prefill-assistant",
			"--models-dir",
			"/tmp/models",
		]);
	});
});
