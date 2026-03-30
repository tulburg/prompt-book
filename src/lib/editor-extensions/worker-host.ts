import {
	buildDocumentDiagnostics,
	buildDocumentWordCompletions,
} from "@/lib/editor-extensions/extensions/document-tools.shared";
import type {
	WorkerRequestMessage,
	WorkerResponseMessage,
} from "@/lib/editor-extensions/protocol";

function buildResponse(message: WorkerRequestMessage): WorkerResponseMessage {
	const { capability, currentWord, extensionId, modelValue } = message.payload;

	if (extensionId !== "document-tools") {
		return {
			id: message.id,
			type: "error",
			error: `Unknown extension: ${extensionId}`,
		};
	}

	if (capability === "completionItems") {
		return {
			id: message.id,
			type: "success",
			payload: buildDocumentWordCompletions(modelValue, currentWord ?? ""),
		};
	}

	if (capability === "diagnostics") {
		return {
			id: message.id,
			type: "success",
			payload: buildDocumentDiagnostics(modelValue),
		};
	}

	return {
		id: message.id,
		type: "error",
		error: `Unsupported capability: ${capability}`,
	};
}

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
	try {
		const response = buildResponse(event.data);
		self.postMessage(response);
	} catch (error) {
		self.postMessage({
			id: event.data.id,
			type: "error",
			error: error instanceof Error ? error.message : "Worker request failed.",
		} satisfies WorkerResponseMessage);
	}
};
