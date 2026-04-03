export type AssistantRenderableSegment =
	| {
			kind: "text";
			content: string;
	  }
	| {
			kind: "thinking";
			content: string;
			isClosed: boolean;
	  };

export interface ParsedAssistantContent {
	segments: AssistantRenderableSegment[];
	hasThinking: boolean;
}

const THINK_OPEN_TAG = "<think>";
const THINK_CLOSE_TAG = "</think>";

function pushSegment(
	segments: AssistantRenderableSegment[],
	segment: AssistantRenderableSegment,
): void {
	if (!segment.content) {
		return;
	}

	const previous = segments.at(-1);
	if (previous && previous.kind === segment.kind) {
		if (segment.kind === "text") {
			previous.content += segment.content;
			return;
		}
		if (previous.kind === "thinking") {
			previous.content += segment.content;
			previous.isClosed = segment.isClosed;
			return;
		}
	}

	segments.push(segment);
}

export function parseAssistantRenderableContent(
	content: string,
): ParsedAssistantContent {
	const segments: AssistantRenderableSegment[] = [];

	let cursor = 0;
	let inThinking = false;

	while (cursor < content.length) {
		if (!inThinking) {
			const nextOpen = content.indexOf(THINK_OPEN_TAG, cursor);
			if (nextOpen === -1) {
				pushSegment(segments, {
					kind: "text",
					content: content.slice(cursor),
				});
				break;
			}

			pushSegment(segments, {
				kind: "text",
				content: content.slice(cursor, nextOpen),
			});
			cursor = nextOpen + THINK_OPEN_TAG.length;
			inThinking = true;
			continue;
		}

		const nextClose = content.indexOf(THINK_CLOSE_TAG, cursor);
		if (nextClose === -1) {
			pushSegment(segments, {
				kind: "thinking",
				content: content.slice(cursor),
				isClosed: false,
			});
			cursor = content.length;
			break;
		}

		pushSegment(segments, {
			kind: "thinking",
			content: content.slice(cursor, nextClose),
			isClosed: true,
		});
		cursor = nextClose + THINK_CLOSE_TAG.length;
		inThinking = false;
	}

	return {
		segments,
		hasThinking: segments.some((segment) => segment.kind === "thinking"),
	};
}
