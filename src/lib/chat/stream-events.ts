import type { ChatStreamMode, ChatUiEvent } from "./types";

export function handleChatStreamEvent(
	event: ChatUiEvent,
	callbacks: {
		onMessage: (event: Extract<ChatUiEvent, { type: "message" }>) => void;
		onSetStreamMode: (mode: ChatStreamMode) => void;
		onStreamingText?: (updater: (current: string | null) => string | null) => void;
	},
): void {
	if (event.type !== "stream_event" && event.type !== "stream_request_start") {
		callbacks.onStreamingText?.(() => null);
		callbacks.onMessage(event);
		return;
	}

	if (event.type === "stream_request_start") {
		callbacks.onSetStreamMode("requesting");
		return;
	}

	if (event.event.type === "message_stop") {
		callbacks.onSetStreamMode("idle");
		return;
	}

	switch (event.event.type) {
		case "message_start":
			return;
		case "content_delta": {
			const deltaText = event.event.text;
			callbacks.onSetStreamMode("responding");
			callbacks.onStreamingText?.((text) => (text ?? "") + deltaText);
			return;
		}
		default:
			return;
	}
}
