export type ModelDownloadPhase =
	| "queued"
	| "resolving"
	| "downloading"
	| "loading"
	| "complete"
	| "error"
	| "cancelled";

export interface PullProgressEvent {
	modelId: string;
	phase: ModelDownloadPhase;
	message: string;
	progress?: number;
	receivedBytes?: number;
	totalBytes?: number;
	canCancel?: boolean;
}

export interface DownloadedModelArtifact {
	modelId: string;
	fileName: string;
	sourcePath: string;
}
