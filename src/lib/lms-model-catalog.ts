export interface LMSModelEntry {
	readonly id: string;
	readonly quantization: string;
	readonly name: string;
	readonly description: string;
	readonly size: string;
	readonly contextWindow: number;
	readonly recommended?: boolean;
}

interface HFModelInfo {
	id: string;
	downloads: number;
	tags?: string[];
}

export async function fetchModelCatalog(signal?: AbortSignal): Promise<LMSModelEntry[]> {
	const url =
		"https://huggingface.co/api/models?author=lmstudio-community&filter=gguf&sort=downloads&direction=-1&limit=60";

	const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(8000) });
	if (!res.ok) {
		throw new Error(`HuggingFace API returned HTTP ${res.status}`);
	}

	const raw = (await res.json()) as HFModelInfo[];

	const entries: LMSModelEntry[] = raw
		.filter((m) => isUsableModel(m.id))
		.map((m) => toEntry(m))
		.filter((e): e is LMSModelEntry => e !== null);

	entries.sort((a, b) => {
		const aCode = isCodingModel(a.name) ? 0 : 1;
		const bCode = isCodingModel(b.name) ? 0 : 1;
		return aCode - bCode;
	});

	const recommendedIdx = entries.findIndex((e) => isCodingModel(e.name));
	const idx = recommendedIdx >= 0 ? recommendedIdx : 0;
	if (entries[idx]) {
		entries[idx] = { ...entries[idx], recommended: true };
	}

	return entries;
}

function isInstructionTuned(repo: string): boolean {
	const lower = repo.toLowerCase();
	if (
		lower.includes("instruct") ||
		lower.includes("reasoning") ||
		lower.includes("thinking") ||
		lower.includes("distill") ||
		lower.includes("chat")
	) {
		return true;
	}
	if (/-it[-.]/.test(lower) || lower.includes("-it-text-") || lower.endsWith("-it-gguf")) {
		return true;
	}
	if (
		lower.includes("deepseek-r1") ||
		lower.startsWith("phi-4") ||
		lower.startsWith("gpt-oss") ||
		/^glm-\d/.test(lower)
	) {
		return true;
	}
	return false;
}

function isUsableModel(id: string): boolean {
	const repo = id.split("/").pop() ?? "";
	if (!repo.endsWith("-GGUF")) {
		return false;
	}

	const lower = repo.toLowerCase();
	if (
		lower.includes("mlx") ||
		lower.includes("embed") ||
		lower.includes("vision") ||
		/[-_]vl[-_]/.test(lower) ||
		lower.endsWith("-vl") ||
		lower.startsWith("vl-")
	) {
		return false;
	}
	if (!/\d+(?:\.\d+)?[bB]/.test(repo)) {
		return false;
	}
	return isInstructionTuned(repo);
}

function toEntry(m: HFModelInfo): LMSModelEntry | null {
	const repo = m.id.split("/").pop();
	if (!repo) {
		return null;
	}

	const name = parseName(repo);
	const size = estimateSize(repo);
	const description = fmtDownloads(m.downloads);

	return {
		id: m.id,
		quantization: "",
		name,
		description,
		size,
		contextWindow: 128000,
	};
}

function parseName(repo: string): string {
	return repo
		.replace(/-GGUF$/i, "")
		.replace(/-/g, " ")
		.replace(/  +/g, " ")
		.trim();
}

function estimateSize(repo: string): string {
	const m = repo.match(/(\d+(?:\.\d+)?)[Bb]/);
	if (!m) {
		return "";
	}
	const b = parseFloat(m[1]);
	const gb = (b * 1e9 * 4.5) / 8 / 1e9;
	return gb < 1 ? `${Math.round(gb * 1024)} MB` : `~${gb.toFixed(1)} GB`;
}

function fmtDownloads(n: number): string {
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M downloads`;
	}
	if (n >= 1_000) {
		return `${Math.round(n / 1_000)}K downloads`;
	}
	return `${n} downloads`;
}

function isCodingModel(name: string): boolean {
	const lower = name.toLowerCase();
	return lower.includes("coder") || lower.includes("code") || lower.includes("starcoder");
}

const HF = "lmstudio-community";

export const LMS_MODEL_CATALOG_FALLBACK: LMSModelEntry[] = [
	{
		id: `${HF}/Qwen2.5-Coder-7B-Instruct-GGUF`,
		quantization: "",
		name: "Qwen 2.5 Coder 7B Instruct",
		description: "Proven code generation and editing. Best balance of speed and quality.",
		size: "~4.7 GB",
		contextWindow: 128000,
		recommended: true,
	},
	{
		id: `${HF}/Qwen3-Coder-30B-A3B-Instruct-GGUF`,
		quantization: "",
		name: "Qwen 3 Coder 30B A3B Instruct",
		description: "Latest top-tier coding model. Fast MoE architecture — only 3B active params.",
		size: "~20 GB",
		contextWindow: 131072,
	},
	{
		id: `${HF}/Devstral-Small-2-24B-Instruct-2512-GGUF`,
		quantization: "",
		name: "Devstral Small 2 24B Instruct",
		description: "Mistral coding agent model. Excellent at multi-step code tasks.",
		size: "~14 GB",
		contextWindow: 128000,
	},
	{
		id: `${HF}/Qwen2.5-Coder-14B-Instruct-GGUF`,
		quantization: "",
		name: "Qwen 2.5 Coder 14B Instruct",
		description: "Higher quality code reasoning. Requires ~10 GB RAM.",
		size: "~9.0 GB",
		contextWindow: 128000,
	},
	{
		id: `${HF}/gpt-oss-20b-GGUF`,
		quantization: "",
		name: "GPT OSS 20B",
		description: "OpenAI open-source chat model. Strong general and coding tasks.",
		size: "~12 GB",
		contextWindow: 128000,
	},
	{
		id: `${HF}/DeepSeek-R1-0528-Qwen3-8B-GGUF`,
		quantization: "",
		name: "DeepSeek R1 0528 Qwen3 8B",
		description: "Strong chain-of-thought reasoning.",
		size: "~5.2 GB",
		contextWindow: 128000,
	},
	{
		id: `${HF}/Meta-Llama-3.1-8B-Instruct-GGUF`,
		quantization: "",
		name: "Meta Llama 3.1 8B Instruct",
		description: "Strong general reasoning and coding.",
		size: "~4.7 GB",
		contextWindow: 128000,
	},
	{
		id: `${HF}/Llama-3.2-3B-Instruct-GGUF`,
		quantization: "",
		name: "Llama 3.2 3B Instruct",
		description: "Fast and lightweight.",
		size: "~2.0 GB",
		contextWindow: 128000,
	},
];
