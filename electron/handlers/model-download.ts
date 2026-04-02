import { downloadFile, listFiles } from "@huggingface/hub";
import type { WebContents } from "electron";
import { createWriteStream } from "node:fs";
import { access, mkdir, rename, stat, unlink } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import type { DownloadedModelArtifact, PullProgressEvent } from "../../src/lib/model-downloads";

const isWindows = process.platform === "win32";
const DOWNLOAD_PROGRESS_CHANNEL = "lms:download-progress";

const DEFAULT_QUANTIZATION_PREFERENCE = [
	"Q4_K_M",
	"Q4_K_S",
	"Q5_K_M",
	"Q5_K_S",
	"Q4_0",
	"Q5_0",
	"Q6_K",
	"Q8_0",
	"BF16",
	"F16",
];

function expandLmsPath(rawPath: string): string {
	let result = rawPath;
	if (result.startsWith("~")) {
		result = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", result.slice(1));
	}
	result = result.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] ?? `%${key}%`);
	return result;
}

export function getLocalModelsDir(): string {
	return isWindows
		? expandLmsPath("%LOCALAPPDATA%\\llama.cpp\\local-models")
		: process.platform === "darwin"
			? expandLmsPath("~/Library/Caches/llama.cpp/local-models")
			: expandLmsPath("~/.cache/llama.cpp/local-models");
}

export function emitDownloadProgress(sender: WebContents, event: PullProgressEvent): void {
	sender.send(DOWNLOAD_PROGRESS_CHANNEL, event);
}

function sanitizeFileComponent(input: string): string {
	return input.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
}

function shouldIgnoreGgufPath(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	return lower.includes("mmproj") || lower.includes("vision") || /(^|[-_/])vl([-_/]|$)/.test(lower);
}

function extractQuantizationToken(filePath: string): string | null {
	const fileName = path.basename(filePath, path.extname(filePath)).toUpperCase();
	const quantizationMatch = fileName.match(
		/(IQ[1-9]_[A-Z0-9]+|Q[2-8](?:_[A-Z0-9]+)+|Q[2-8]_0|BF16|F16|FP16|FP32|MXFP4|TQ\d(?:_[A-Z0-9]+)?)/,
	);
	return quantizationMatch?.[1] ?? null;
}

function getQuantizationRank(filePath: string, requestedQuantization?: string): number {
	const token = extractQuantizationToken(filePath);
	if (!token) {
		return DEFAULT_QUANTIZATION_PREFERENCE.length + 2;
	}
	if (requestedQuantization) {
		const normalizedRequested = requestedQuantization.trim().toUpperCase();
		if (token === normalizedRequested || token.includes(normalizedRequested)) {
			return -1;
		}
	}
	const preferredIndex = DEFAULT_QUANTIZATION_PREFERENCE.findIndex((candidate) => token.includes(candidate));
	return preferredIndex === -1 ? DEFAULT_QUANTIZATION_PREFERENCE.length + 1 : preferredIndex;
}

function getDestinationFileName(modelId: string, filePath: string): string {
	const [author] = modelId.split("/");
	const repoName = modelId.split("/").pop() ?? modelId;
	const fileName = path.basename(filePath);
	return sanitizeFileComponent(`${author}__${repoName}__${fileName}`);
}

async function resolveDownloadTarget(
	modelId: string,
	quantization?: string,
): Promise<{ sourcePath: string; fileName: string; totalBytes: number }> {
	const repo = { type: "model" as const, name: modelId };
	const candidates: Array<{ path: string; size: number }> = [];

	for await (const entry of listFiles({ repo, recursive: true })) {
		if (entry.type !== "file") continue;
		if (!entry.path.toLowerCase().endsWith(".gguf")) continue;
		if (shouldIgnoreGgufPath(entry.path)) continue;
		candidates.push({ path: entry.path, size: entry.size });
	}

	if (candidates.length === 0) {
		throw new Error(`No downloadable GGUF files found for ${modelId}.`);
	}

	candidates.sort((a, b) => {
		const quantRankDiff = getQuantizationRank(a.path, quantization) - getQuantizationRank(b.path, quantization);
		if (quantRankDiff !== 0) return quantRankDiff;
		const sizeDiff = a.size - b.size;
		if (sizeDiff !== 0) return sizeDiff;
		return a.path.localeCompare(b.path);
	});

	const selected = candidates[0];
	return {
		sourcePath: selected.path,
		fileName: getDestinationFileName(modelId, selected.path),
		totalBytes: selected.size,
	};
}

async function fileExistsWithSize(filePath: string, expectedSize: number): Promise<boolean> {
	try {
		const info = await stat(filePath);
		return info.isFile() && (expectedSize <= 0 || info.size === expectedSize);
	} catch {
		return false;
	}
}

async function ensureParentDirectory(filePath: string): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
}

async function removeIfExists(filePath: string): Promise<void> {
	try {
		await access(filePath);
		await unlink(filePath);
	} catch {
		// ignore
	}
}

async function writeBlobToDisk({
	blob,
	destinationPath,
	modelId,
	totalBytes,
	signal,
	sender,
}: {
	blob: Blob;
	destinationPath: string;
	modelId: string;
	totalBytes: number;
	signal: AbortSignal;
	sender: WebContents;
}): Promise<void> {
	const tempPath = `${destinationPath}.download`;
	await ensureParentDirectory(destinationPath);
	await removeIfExists(tempPath);

	const writer = createWriteStream(tempPath);
	const reader = blob.stream().getReader();
	let receivedBytes = 0;
	let lastEmit = 0;

	const abortError = () => new Error("Download cancelled.");
	const onAbort = () => {
		writer.destroy(abortError());
	};

	signal.addEventListener("abort", onAbort, { once: true });

	try {
		while (true) {
			if (signal.aborted) {
				throw abortError();
			}

			const { done, value } = await reader.read();
			if (done) break;
			if (!value || value.byteLength === 0) continue;

			receivedBytes += value.byteLength;
			if (!writer.write(Buffer.from(value))) {
				await once(writer, "drain");
			}

			const now = Date.now();
			if (now - lastEmit >= 200 || (totalBytes > 0 && receivedBytes >= totalBytes)) {
				emitDownloadProgress(sender, {
					modelId,
					phase: "downloading",
					message:
						totalBytes > 0
							? `Downloading ${Math.max(1, Math.round((receivedBytes / totalBytes) * 100))}%`
							: "Downloading model...",
					progress: totalBytes > 0 ? Math.min(99, (receivedBytes / totalBytes) * 100) : undefined,
					receivedBytes,
					totalBytes: totalBytes > 0 ? totalBytes : undefined,
					canCancel: true,
				});
				lastEmit = now;
			}
		}

		await new Promise<void>((resolve, reject) => {
			writer.end((error?: Error | null) => {
				if (error) reject(error);
				else resolve();
			});
		});
		await rename(tempPath, destinationPath);
	} catch (error) {
		reader.cancel().catch(() => undefined);
		writer.destroy();
		await removeIfExists(tempPath);
		throw error;
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

function makeAbortableFetch(signal: AbortSignal): typeof fetch {
	return (input, init) => fetch(input, { ...init, signal });
}

export async function downloadModelToLocalStore({
	modelId,
	progressModelId,
	quantization,
	signal,
	sender,
}: {
	modelId: string;
	progressModelId?: string;
	quantization?: string;
	signal: AbortSignal;
	sender: WebContents;
}): Promise<DownloadedModelArtifact> {
	const eventModelId = progressModelId ?? modelId;
	emitDownloadProgress(sender, {
		modelId: eventModelId,
		phase: "queued",
		message: "Queued for download...",
		canCancel: true,
	});

	emitDownloadProgress(sender, {
		modelId: eventModelId,
		phase: "resolving",
		message: "Finding the best GGUF file...",
		canCancel: true,
	});

	const target = await resolveDownloadTarget(modelId, quantization);
	const localModelsDir = getLocalModelsDir();
	const destinationPath = path.join(localModelsDir, target.fileName);
	await ensureParentDirectory(destinationPath);

	if (await fileExistsWithSize(destinationPath, target.totalBytes)) {
		emitDownloadProgress(sender, {
			modelId: eventModelId,
			phase: "complete",
			message: "Model already downloaded.",
			progress: 100,
		});
		return {
			modelId: eventModelId,
			fileName: target.fileName,
			sourcePath: target.sourcePath,
		};
	}

	const blob = await downloadFile({
		repo: { type: "model", name: modelId },
		path: target.sourcePath,
		xet: true,
		fetch: makeAbortableFetch(signal),
	});

	if (!blob) {
		throw new Error(`Unable to download ${target.sourcePath} from ${modelId}.`);
	}

	await writeBlobToDisk({
		blob,
		destinationPath,
		modelId: eventModelId,
		totalBytes: target.totalBytes,
		signal,
		sender,
	});

	emitDownloadProgress(sender, {
		modelId: eventModelId,
		phase: "complete",
		message: "Download complete.",
		progress: 100,
	});

	return {
		modelId: eventModelId,
		fileName: target.fileName,
		sourcePath: target.sourcePath,
	};
}
