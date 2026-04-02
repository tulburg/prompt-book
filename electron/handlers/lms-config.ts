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
		// We want plain assistant text in content, not provider-specific reasoning fields.
		"--reasoning-format",
		"none",
		// Never treat prior assistant content as a continuation prefill.
		"--no-prefill-assistant",
	];

	if (localModelsDir) {
		args.push("--models-dir", localModelsDir);
	}

	return args;
}
