import type {
	SerializableCompletionItem,
	SerializableMarkerData,
} from "@/lib/editor-extensions/extensions/document-tools.shared";

export type WorkerCapability = "completionItems" | "diagnostics";

export interface WorkerRequestPayload {
	extensionId: string;
	capability: WorkerCapability;
	languageId: string;
	modelValue: string;
	currentWord?: string;
}

export interface WorkerRequestMessage {
	id: number;
	type: "request";
	payload: WorkerRequestPayload;
}

export interface WorkerSuccessMessage {
	id: number;
	type: "success";
	payload: SerializableCompletionItem[] | SerializableMarkerData[];
}

export interface WorkerErrorMessage {
	id: number;
	type: "error";
	error: string;
}

export type WorkerResponseMessage = WorkerSuccessMessage | WorkerErrorMessage;
