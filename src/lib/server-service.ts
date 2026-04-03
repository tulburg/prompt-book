import type { ChatModelInfo } from "./chat/chat-models";
import type { DownloadedModelArtifact, PullProgressEvent } from "./model-downloads";

export type LlamaServerStatus = "stopped" | "starting" | "running" | "error";

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

export interface LlamaInstalledModelInfo extends ChatModelInfo {
	provider: "llama";
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

	private readonly _onDidRecover = new SimpleEmitter<void>();
	readonly onDidRecover = this._onDidRecover.on.bind(this._onDidRecover);

	private _status: LlamaServerStatus = "stopped";
	private _pullAborts = new Map<string, AbortController>();
	private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private _activeModelId: string | null = null;
	private _recovering = false;

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
			console.warn("[LlamaServer] /health returned non-OK:", health.status, health.statusText);
		} catch (error) {
			console.debug("[LlamaServer] /health unreachable:", error instanceof Error ? error.message : String(error));
		}

		try {
			const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1500) });
			if (!response.ok) {
				console.warn("[LlamaServer] /models returned non-OK:", response.status, response.statusText);
			}
			return response.ok;
		} catch (error) {
			console.debug("[LlamaServer] /models unreachable:", error instanceof Error ? error.message : String(error));
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
					provider: "llama",
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
			if (!response.ok) {
				console.warn("[LlamaServer] getModelStatus: /models returned", response.status);
				return null;
			}
			const payload = (await response.json()) as { data?: Array<{ id?: string; status?: { value?: string } }> };
			const models = payload.data ?? [];
			const match = models.find((m) => m.id === modelId);
			const status = match?.status?.value ?? null;
			console.debug("[LlamaServer] getModelStatus:", { modelId, status, allModels: models.map((m) => ({ id: m.id, status: m.status?.value })) });
			return status;
		} catch (error) {
			console.warn("[LlamaServer] getModelStatus failed:", error instanceof Error ? error.message : String(error));
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
			this._activeModelId = normalizedModelId;
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
					this._activeModelId = normalizedModelId;
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
		console.log("[LlamaServer] startServer called, baseUrl:", baseUrl);
		this._setStatus("starting");

		const healthy = await this.isServerHealthy(baseUrl);
		if (healthy) {
			console.log("[LlamaServer] startServer: already healthy");
			this._setStatus("running");
			return;
		}

		try {
			console.log("[LlamaServer] startServer: requesting IPC start...");
			if (window.llamaBridge) {
				await window.llamaBridge.startServer(baseUrl);
			} else {
				await window.ipcRenderer.invoke("llama:start-server", baseUrl);
			}
			console.log("[LlamaServer] startServer: IPC done, waiting for server...");
			await this.waitForServer(baseUrl);
		} catch (error) {
			console.error("[LlamaServer] startServer failed:", error instanceof Error ? error.message : String(error));
			this._setStatus("error");
		}
	}

	async stopServer(_serverUrl?: string): Promise<void> {
		console.log("[LlamaServer] stopServer called");
		try {
			if (window.llamaBridge) {
				await window.llamaBridge.stopServer();
			} else {
				await window.ipcRenderer.invoke("llama:stop-server");
			}
			this._setStatus("stopped");
		} catch (error) {
			console.error("[LlamaServer] stopServer failed:", error instanceof Error ? error.message : String(error));
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

		console.warn("[LlamaServer] waitForServer timed out after", timeoutMs, "ms");
		this._setStatus("error");
	}

	startHeartbeat(intervalMs = 10_000): void {
		this.stopHeartbeat();
		console.log("[LlamaServer] Starting heartbeat, interval:", intervalMs);
		this._heartbeatTimer = setInterval(() => void this._heartbeatCheck(), intervalMs);
	}

	stopHeartbeat(): void {
		if (this._heartbeatTimer) {
			clearInterval(this._heartbeatTimer);
			this._heartbeatTimer = null;
		}
	}

	private async _heartbeatCheck(): Promise<void> {
		if (this._status !== "running" || this._recovering) return;

		const t0 = Date.now();
		const healthy = await this.isServerHealthy();
		const elapsed = Date.now() - t0;
		if (healthy) {
			console.debug(`[LlamaServer] Heartbeat: OK (${elapsed}ms), activeModel=${this._activeModelId}`);
			return;
		}

		console.warn(`[LlamaServer] Heartbeat: server NOT healthy (check took ${elapsed}ms), status=${this._status}, activeModel=${this._activeModelId}`);
		this._recovering = true;
		this._setStatus("starting");

		const MAX_WAIT_MS = 30_000;
		const POLL_MS = 2_000;
		const deadline = Date.now() + MAX_WAIT_MS;
		let recovered = false;
		let attempts = 0;

		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, POLL_MS));
			attempts++;
			const ok = await this.isServerHealthy();
			console.debug(`[LlamaServer] Heartbeat recovery poll #${attempts}: healthy=${ok}`);
			if (ok) {
				recovered = true;
				break;
			}
		}

		if (!recovered) {
			console.warn("[LlamaServer] Heartbeat: auto-restart did not restore server, requesting manual startServer...");
			try {
				await this.startServer();
				recovered = this._status === "running";
			} catch (error) {
				console.error("[LlamaServer] Heartbeat: startServer failed:", error instanceof Error ? error.message : String(error));
				recovered = false;
			}
		}

		if (recovered) {
			this._setStatus("running");
			console.info("[LlamaServer] Heartbeat: server recovered after", Date.now() - t0, "ms");
			if (this._activeModelId) {
				console.info("[LlamaServer] Heartbeat: reloading model:", this._activeModelId);
				try {
					await this.loadModel(this._activeModelId);
					console.info("[LlamaServer] Heartbeat: model reloaded successfully");
				} catch (error) {
					console.error("[LlamaServer] Heartbeat: failed to reload model:", error instanceof Error ? error.message : String(error));
				}
			}
			this._onDidRecover.fire();
		} else {
			console.error("[LlamaServer] Heartbeat: recovery FAILED after", Date.now() - t0, "ms and", attempts, "polls");
			this._setStatus("error");
		}

		this._recovering = false;
	}

	private _setStatus(status: LlamaServerStatus): void {
		if (this._status === status) {
			return;
		}
		const prev = this._status;
		this._status = status;
		console.log(`[LlamaServer] Status: ${prev} → ${status}`);
		this._onDidChangeStatus.fire(status);
	}
}

export const llamaServerService = new LlamaServerService();
