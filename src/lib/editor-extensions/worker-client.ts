import type {
	SerializableCompletionItem,
	SerializableMarkerData,
} from "@/lib/editor-extensions/extensions/document-tools.shared";
import type {
	WorkerCapability,
	WorkerRequestMessage,
	WorkerRequestPayload,
	WorkerResponseMessage,
} from "@/lib/editor-extensions/protocol";

import WorkerHost from "@/lib/editor-extensions/worker-host?worker";

type WorkerResultMap = {
	completionItems: SerializableCompletionItem[];
	diagnostics: SerializableMarkerData[];
};

interface PendingRequest {
	reject: (reason?: unknown) => void;
	resolve: (value: SerializableCompletionItem[] | SerializableMarkerData[]) => void;
}

export class EditorExtensionWorkerClient {
	private nextRequestId = 0;
	private pendingRequests = new Map<number, PendingRequest>();
	private readonly worker = new WorkerHost();

	constructor() {
		this.worker.addEventListener("message", this.handleMessage as EventListener);
		this.worker.addEventListener("error", this.handleError as EventListener);
	}

	request<TCapability extends WorkerCapability>(
		payload: WorkerRequestPayload & {
			capability: TCapability;
		},
	) {
		return new Promise<WorkerResultMap[TCapability]>((resolve, reject) => {
			const id = this.nextRequestId++;
			this.pendingRequests.set(id, {
				resolve: resolve as PendingRequest["resolve"],
				reject,
			});
			const message: WorkerRequestMessage = {
				id,
				type: "request",
				payload,
			};
			this.worker.postMessage(message);
		});
	}

	dispose() {
		for (const pendingRequest of this.pendingRequests.values()) {
			pendingRequest.reject(new Error("Extension worker client disposed."));
		}
		this.pendingRequests.clear();
		this.worker.removeEventListener("message", this.handleMessage as EventListener);
		this.worker.removeEventListener("error", this.handleError as EventListener);
		this.worker.terminate();
	}

	private handleMessage = (event: MessageEvent<WorkerResponseMessage>) => {
		const pendingRequest = this.pendingRequests.get(event.data.id);
		if (!pendingRequest) {
			return;
		}

		this.pendingRequests.delete(event.data.id);
		if (event.data.type === "error") {
			pendingRequest.reject(new Error(event.data.error));
			return;
		}

		pendingRequest.resolve(event.data.payload);
	};

	private handleError = (event: ErrorEvent) => {
		const error = new Error(event.message || "Extension worker request failed.");
		for (const pendingRequest of this.pendingRequests.values()) {
			pendingRequest.reject(error);
		}
		this.pendingRequests.clear();
	};
}
