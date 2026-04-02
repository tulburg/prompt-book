export interface LlamaServerStartConfig {
	port: string;
	localModelsDir?: string;
}

export function buildLlamaServerArgs({
	port,
	localModelsDir,
}: LlamaServerStartConfig): string[] {
	const args = [
		"--host",
		"127.0.0.1",
		"--port",
		port,
		// Keep local chat rendering aligned with the model's Jinja chat template.
		"--jinja",
		// Extract reasoning/thinking into reasoning_content so it doesn't appear
		// in the main content, but still allow the model to think (required by
		// thinking models like Qwen3-Coder). "none" breaks these models entirely.
		"--reasoning-format",
		"deepseek",
		// Never treat prior assistant content as a continuation prefill.
		"--no-prefill-assistant",
	];

	if (localModelsDir) {
		args.push("--models-dir", localModelsDir);
	}

	return args;
}
