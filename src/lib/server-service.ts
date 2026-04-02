export type LMServerStatus = "stopped" | "starting" | "running" | "error";

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

export interface LMSInstalledModelInfo {
	id: string;
	displayName: string;
	maxContextLength?: number;
	vision?: boolean;
	trainedForToolUse?: boolean;
}

export interface LMSLoadModelOptions {
	contextLength?: number;
	serverUrl?: string;
}

export interface PullProgressEvent {
	modelId: string;
	message: string;
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

const DEFAULT_LLAMA_SERVER_URL = "http://localhost:8123";

export class LMSServerService {
	private readonly _onDidChangeStatus = new SimpleEmitter<LMServerStatus>();
	readonly onDidChangeStatus = this._onDidChangeStatus.on.bind(this._onDidChangeStatus);

	private readonly _onDidLoadModel = new SimpleEmitter<void>();
	readonly onDidLoadModel = this._onDidLoadModel.on.bind(this._onDidLoadModel);

	private readonly _onDidLoadProgress = new SimpleEmitter<number>();
	readonly onDidLoadProgress = this._onDidLoadProgress.on.bind(this._onDidLoadProgress);

	private readonly _onDidPullProgress = new SimpleEmitter<PullProgressEvent>();
	readonly onDidPullProgress = this._onDidPullProgress.on.bind(this._onDidPullProgress);

	private _status: LMServerStatus = "stopped";
	private _pullAborts = new Map<string, AbortController>();

	get status(): LMServerStatus {
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

	async listInstalledModels(serverUrl?: string): Promise<LMSInstalledModelInfo[]> {
		const baseUrl = this.normalizeServerUrl(serverUrl);
		const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(4000) });
		if (!response.ok) {
			throw new Error(`GET /models failed with HTTP ${response.status}`);
		}

		const payload = (await response.json()) as
			| { data?: Array<{ id?: string; meta?: { max_context_length?: number; n_ctx_train?: number; multimodal?: boolean; tools?: boolean } }> }
			| Array<{ id?: string; meta?: { max_context_length?: number; n_ctx_train?: number; multimodal?: boolean; tools?: boolean } }>;

		const models = Array.isArray(payload) ? payload : payload.data ?? [];

		return models
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
	}

	async loadModel(modelId: string, options: LMSLoadModelOptions = {}): Promise<void> {
		const baseUrl = this.normalizeServerUrl(options.serverUrl);
		const normalizedModelId = normalizePullModelId(modelId);

		this._onDidLoadProgress.fire(0);
		let loadProgress = 0;
		const timer = setInterval(() => {
			loadProgress = Math.min(95, loadProgress + 5);
			this._onDidLoadProgress.fire(loadProgress);
		}, 400);

		try {
			const response = await fetch(`${baseUrl}/models/load`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model: normalizedModelId }),
			});
			if (!response.ok) {
				const errorText = await response.text().catch(() => "");
				if (!(response.status === 400 && /model is already loaded/i.test(errorText))) {
					throw new Error(`Failed to load model: HTTP ${response.status}${errorText ? ` — ${errorText}` : ""}`);
				}
			}

			this._onDidLoadProgress.fire(100);
			this._onDidLoadModel.fire();
		} finally {
			clearInterval(timer);
		}
	}

	async pullModel(modelId: string, quantization?: string): Promise<void> {
		const normalizedModelId = normalizePullModelId(modelId, quantization);
		const abort = new AbortController();
		this._pullAborts.set(normalizedModelId, abort);
		this._onDidPullProgress.fire({ modelId: normalizedModelId, message: "Starting download..." });

		let unsubProgress: (() => void) | undefined;
		try {
			if (window.lmsBridge) {
				unsubProgress = window.lmsBridge.onDownloadProgress((data) => {
					this._onDidPullProgress.fire(data);
				});
				await window.lmsBridge.downloadModel(normalizedModelId);
			} else {
				await window.ipcRenderer.invoke("lms:download-model", normalizedModelId);
			}

			this._onDidPullProgress.fire({ modelId: normalizedModelId, message: "Loading model..." });

			await this.stopServer();
			await this.startServer();
			await this.loadModel(normalizedModelId);

			if (!abort.signal.aborted) {
				this._onDidPullProgress.fire({ modelId: normalizedModelId, message: "Download complete!" });
			}
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
			if (window.lmsBridge) {
				await window.lmsBridge.startServer(baseUrl);
			} else {
				await window.ipcRenderer.invoke("lms:start-server", baseUrl);
			}
			await this.waitForServer(baseUrl);
		} catch {
			this._setStatus("error");
		}
	}

	async stopServer(_serverUrl?: string): Promise<void> {
		try {
			if (window.lmsBridge) {
				await window.lmsBridge.stopServer();
			} else {
				await window.ipcRenderer.invoke("lms:stop-server");
			}
			this._setStatus("stopped");
		} catch {
			this._setStatus("error");
		}
	}

	async isBinaryInstalled(): Promise<boolean> {
		try {
			if (window.lmsBridge) {
				return await window.lmsBridge.isBinaryInstalled();
			}
			return await window.ipcRenderer.invoke("lms:is-binary-installed") as boolean;
		} catch {
			return false;
		}
	}

	async downloadBinary(): Promise<void> {
		if (window.lmsBridge) {
			await window.lmsBridge.downloadBinary();
			return;
		}
		await window.ipcRenderer.invoke("lms:download-binary");
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

	private _setStatus(status: LMServerStatus): void {
		if (this._status === status) {
			return;
		}
		this._status = status;
		this._onDidChangeStatus.fire(status);
	}
}

export const lmsServerService = new LMSServerService();
