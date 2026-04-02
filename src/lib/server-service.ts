export type LlamaServerStatus = "stopped" | "starting" | "running" | "error";

import type { DownloadedModelArtifact, PullProgressEvent } from "./model-downloads";

export function normalizePullModelId(modelId: string, quantization?: string): string {
	let normalized = modelId.trim();
	if (normalized.startsWith("https://huggingface.co/")) {
		normalized = normalized.slice("https://huggingface.co/".length);
	}
	normalized = normalized.replace(/\/$/, "");
	if (quantization?.trim() && !normalized.includes(":")) {
		normalized = `${normalized}:${quantization.trim()}`;
	}
	return normalized;
}

export interface LlamaInstalledModelInfo {
	id: string;
	displayName: string;
	maxContextLength?: number;
	vision?: boolean;
	trainedForToolUse?: boolean;
}

export interface LlamaLoadModelOptions {
	contextLength?: number;
	serverUrl?: string;
}

type Listener<T> = (value: T) => void;

class SimpleEmitter<T> {
	private listeners = new Set<Listener<T>>();

	on(listener: Listener<T>): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	fire(value: T): void {
		for (const listener of this.listeners) {
			listener(value);
		}
	}
}

const DEFAULT_LLAMA_SERVER_URL = "http://localhost:48123";

function resolveInstalledModelAfterDownload(
	models: LlamaInstalledModelInfo[],
	artifact: DownloadedModelArtifact,
): LlamaInstalledModelInfo | null {
	const lowerFileName = artifact.fileName.toLowerCase();
	const fileStem = lowerFileName.replace(/\.gguf$/i, "");

	const ranked = models
		.map((model) => {
			const lowerId = model.id.toLowerCase();
			const lowerDisplayName = model.displayName.toLowerCase();

			if (lowerId === lowerFileName || lowerDisplayName === lowerFileName) {
				return { model, score: 0 };
			}
			if (lowerId.endsWith(`/${lowerFileName}`) || lowerId.endsWith(`\\${lowerFileName}`)) {
				return { model, score: 1 };
			}
			if (lowerId.includes(fileStem) || lowerDisplayName.includes(fileStem)) {
				return { model, score: 2 };
			}
			return { model, score: Number.POSITIVE_INFINITY };
		})
		.filter((entry) => Number.isFinite(entry.score))
		.sort((a, b) => a.score - b.score);

	return ranked[0]?.model ?? null;
}

export class LlamaServerService {
	private readonly _onDidChangeStatus = new SimpleEmitter<LlamaServerStatus>();
	readonly onDidChangeStatus = this._onDidChangeStatus.on.bind(this._onDidChangeStatus);

	private readonly _onDidLoadModel = new SimpleEmitter<void>();
	readonly onDidLoadModel = this._onDidLoadModel.on.bind(this._onDidLoadModel);

	private readonly _onDidLoadProgress = new SimpleEmitter<number>();
	readonly onDidLoadProgress = this._onDidLoadProgress.on.bind(this._onDidLoadProgress);

	private readonly _onDidPullProgress = new SimpleEmitter<PullProgressEvent>();
	readonly onDidPullProgress = this._onDidPullProgress.on.bind(this._onDidPullProgress);

	private _status: LlamaServerStatus = "stopped";
	private _pullAborts = new Map<string, AbortController>();

	get status(): LlamaServerStatus {
		return this._status;
	}

	private normalizeServerUrl(serverUrl?: string): string {
		return (serverUrl || DEFAULT_LLAMA_SERVER_URL).replace(/\/$/, "");
	}

	async isServerHealthy(serverUrl?: string): Promise<boolean> {
		const baseUrl = this.normalizeServerUrl(serverUrl);
		try {
			const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
			if (health.ok) {
				return true;
			}
		} catch {
			// fall through
		}

		try {
			const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1500) });
			return response.ok;
		} catch {
			return false;
		}
	}

	async listInstalledModels(serverUrl?: string): Promise<LlamaInstalledModelInfo[]> {
		const baseUrl = this.normalizeServerUrl(serverUrl);
		console.log("[LlamaServer] listInstalledModels → GET", `${baseUrl}/models`);
		const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(4000) });
		if (!response.ok) {
			console.error("[LlamaServer] listInstalledModels failed:", response.status);
			throw new Error(`GET /models failed with HTTP ${response.status}`);
		}

		const payload = (await response.json()) as
			| { data?: Array<{ id?: string; meta?: { max_context_length?: number; n_ctx_train?: number; multimodal?: boolean; tools?: boolean } }> }
			| Array<{ id?: string; meta?: { max_context_length?: number; n_ctx_train?: number; multimodal?: boolean; tools?: boolean } }>;

		const models = Array.isArray(payload) ? payload : payload.data ?? [];
		console.log("[LlamaServer] listInstalledModels raw response:", JSON.stringify(payload, null, 2));

		const result = models
			.filter((model) => !!model.id)
			.map((model) => {
				const id = model.id!;
				const displayName = id.split("/").pop() ?? id;
				return {
					id,
					displayName,
					maxContextLength: model.meta?.max_context_length ?? model.meta?.n_ctx_train,
					vision: model.meta?.multimodal,
					trainedForToolUse: model.meta?.tools,
				};
			});
		console.log("[LlamaServer] listInstalledModels result:", result.map((m) => m.id));
		return result;
	}

	private async getModelStatus(baseUrl: string, modelId: string): Promise<string | null> {
		try {
			const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(4000) });
			if (!response.ok) return null;
			const payload = (await response.json()) as { data?: Array<{ id?: string; status?: { value?: string } }> };
			const models = payload.data ?? [];
			const match = models.find((m) => m.id === modelId);
			return match?.status?.value ?? null;
		} catch {
			return null;
		}
	}

	async loadModel(modelId: string, options: LlamaLoadModelOptions = {}): Promise<void> {
		const baseUrl = this.normalizeServerUrl(options.serverUrl);
		const normalizedModelId = normalizePullModelId(modelId);

		console.log("[LlamaServer] loadModel called:", { modelId, normalizedModelId, baseUrl });

		const existingStatus = await this.getModelStatus(baseUrl, normalizedModelId);
		if (existingStatus === "loaded") {
			console.log("[LlamaServer] loadModel: already loaded, skipping");
			this._onDidLoadProgress.fire(100);
			this._onDidLoadModel.fire();
			return;
		}

		this._onDidLoadProgress.fire(0);
		let loadProgress = 0;
		const timer = setInterval(() => {
			loadProgress = Math.min(95, loadProgress + 5);
			this._onDidLoadProgress.fire(loadProgress);
		}, 400);

		try {
			const url = `${baseUrl}/models/load`;
			const body = JSON.stringify({ model: normalizedModelId });
			console.log("[LlamaServer] loadModel → POST", url, body);
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			});
			const responseText = await response.text().catch(() => "");
			console.log("[LlamaServer] loadModel POST response:", { status: response.status, body: responseText });
			if (!response.ok) {
				if (!(response.status === 400 && /model is already loaded/i.test(responseText))) {
					throw new Error(`Failed to load model: HTTP ${response.status}${responseText ? ` — ${responseText}` : ""}`);
				}
				console.log("[LlamaServer] loadModel: already-loaded response, done");
				this._onDidLoadProgress.fire(100);
				this._onDidLoadModel.fire();
				return;
			}

			console.log("[LlamaServer] loadModel: waiting for model to finish loading...");
			const deadline = Date.now() + 120_000;
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 1000));
				const status = await this.getModelStatus(baseUrl, normalizedModelId);
				console.log("[LlamaServer] loadModel poll:", { modelId: normalizedModelId, status });
				if (status === "loaded") {
					console.log("[LlamaServer] loadModel: model is now loaded ✓");
					this._onDidLoadProgress.fire(100);
					this._onDidLoadModel.fire();
					return;
				}
				if (status === "unloaded") {
					const failStatus = await this.getModelStatus(baseUrl, normalizedModelId);
					throw new Error(`Model failed to load (status: ${failStatus ?? "unloaded"})`);
				}
			}

			throw new Error("Timed out waiting for model to load (120s)");
		} catch (error) {
			console.error("[LlamaServer] loadModel error:", error);
			throw error;
		} finally {
			clearInterval(timer);
		}
	}

	async pullModel(modelId: string, quantization?: string): Promise<LlamaInstalledModelInfo | null> {
		const normalizedModelId = normalizePullModelId(modelId, quantization);
		const abort = new AbortController();
		this._pullAborts.set(normalizedModelId, abort);
		this._onDidPullProgress.fire({
			modelId: normalizedModelId,
			phase: "queued",
			message: "Starting download...",
			canCancel: true,
		});

		let unsubProgress: (() => void) | undefined;
		try {
			let artifact: DownloadedModelArtifact | null = null;
			if (window.llamaBridge) {
				unsubProgress = window.llamaBridge.onDownloadProgress((data) => {
					this._onDidPullProgress.fire(data);
				});
				artifact = await window.llamaBridge.downloadModel(normalizedModelId);
			} else {
				artifact = await window.ipcRenderer.invoke("llama:download-model", normalizedModelId) as DownloadedModelArtifact;
			}

			if (abort.signal.aborted) {
				return null;
			}

			this._onDidPullProgress.fire({
				modelId: normalizedModelId,
				phase: "loading",
				message: "Refreshing model list...",
			});

			await this.stopServer();
			await this.startServer();
			const installedModels = await this.listInstalledModels();
			const resolvedModel = artifact ? resolveInstalledModelAfterDownload(installedModels, artifact) : null;
			if (resolvedModel) {
				this._onDidPullProgress.fire({
					modelId: normalizedModelId,
					phase: "loading",
					message: "Loading downloaded model...",
				});
				await this.loadModel(resolvedModel.id);
			}

			if (!abort.signal.aborted) {
				this._onDidPullProgress.fire({
					modelId: normalizedModelId,
					phase: "complete",
					message: resolvedModel ? "Download complete." : "Downloaded. Select the model from the picker.",
					progress: 100,
				});
			}
			return resolvedModel;
		} finally {
			unsubProgress?.();
			if (this._pullAborts.get(normalizedModelId) === abort) {
				this._pullAborts.delete(normalizedModelId);
			}
		}
	}

	async cancelPullModel(modelId: string): Promise<void> {
		const normalizedModelId = normalizePullModelId(modelId);
		this._pullAborts.get(normalizedModelId)?.abort();
		this._pullAborts.delete(normalizedModelId);
		this._onDidPullProgress.fire({
			modelId: normalizedModelId,
			phase: "cancelled",
			message: "Download cancelled.",
		});
		if (window.llamaBridge) {
			await window.llamaBridge.cancelDownloadModel(normalizedModelId);
			return;
		}
		await window.ipcRenderer.invoke("llama:cancel-download-model", normalizedModelId);
	}

	async startServer(serverUrl?: string): Promise<void> {
		const baseUrl = this.normalizeServerUrl(serverUrl);
		this._setStatus("starting");

		const healthy = await this.isServerHealthy(baseUrl);
		if (healthy) {
			this._setStatus("running");
			return;
		}

		try {
			if (window.llamaBridge) {
				await window.llamaBridge.startServer(baseUrl);
			} else {
				await window.ipcRenderer.invoke("llama:start-server", baseUrl);
			}
			await this.waitForServer(baseUrl);
		} catch {
			this._setStatus("error");
		}
	}

	async stopServer(_serverUrl?: string): Promise<void> {
		try {
			if (window.llamaBridge) {
				await window.llamaBridge.stopServer();
			} else {
				await window.ipcRenderer.invoke("llama:stop-server");
			}
			this._setStatus("stopped");
		} catch {
			this._setStatus("error");
		}
	}

	async isBinaryInstalled(): Promise<boolean> {
		try {
			if (window.llamaBridge) {
				return await window.llamaBridge.isBinaryInstalled();
			}
			return await window.ipcRenderer.invoke("llama:is-binary-installed") as boolean;
		} catch {
			return false;
		}
	}

	async downloadBinary(): Promise<void> {
		if (window.llamaBridge) {
			await window.llamaBridge.downloadBinary();
			return;
		}
		await window.ipcRenderer.invoke("llama:download-binary");
	}

	private async waitForServer(baseUrl: string, timeoutMs = 25000, intervalMs = 500): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (await this.isServerHealthy(baseUrl)) {
				this._setStatus("running");
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}

		this._setStatus("running");
	}

	private _setStatus(status: LlamaServerStatus): void {
		if (this._status === status) {
			return;
		}
		this._status = status;
		this._onDidChangeStatus.fire(status);
	}
}

export const llamaServerService = new LlamaServerService();
