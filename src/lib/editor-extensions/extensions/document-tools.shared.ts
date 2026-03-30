export interface SerializableCompletionItem {
	label: string;
	insertText: string;
	detail?: string;
	documentation?: string;
}

export interface SerializableMarkerData {
	message: string;
	severity: "info" | "warning" | "error";
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	source: string;
}

export interface SerializableHoverData {
	value: string;
	startColumn: number;
	endColumn: number;
}

const WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_-]{2,}/g;

function buildWordFrequencyMap(documentText: string) {
	const wordFrequency = new Map<string, number>();
	for (const match of documentText.matchAll(WORD_PATTERN)) {
		const word = match[0];
		wordFrequency.set(word, (wordFrequency.get(word) ?? 0) + 1);
	}
	return wordFrequency;
}

export function buildDocumentWordCompletions(documentText: string, currentWord: string) {
	const prefix = currentWord.trim().toLowerCase();
	if (!prefix) {
		return [];
	}

	return [...buildWordFrequencyMap(documentText).entries()]
		.filter(([word]) => word.toLowerCase().startsWith(prefix) && word !== currentWord)
		.sort((left, right) => {
			if (right[1] !== left[1]) {
				return right[1] - left[1];
			}
			return left[0].localeCompare(right[0]);
		})
		.slice(0, 12)
		.map(([word]) => ({
			label: word,
			insertText: word,
			detail: "Built-in document completion",
			documentation: "Suggested from words already present in the current file.",
		}));
}

export function buildDocumentDiagnostics(documentText: string): SerializableMarkerData[] {
	const markers: SerializableMarkerData[] = [];
	const lines = documentText.split("\n");

	for (const [index, line] of lines.entries()) {
		const lineNumber = index + 1;
		const trailingWhitespaceMatch = line.match(/\s+$/);
		if (trailingWhitespaceMatch) {
			const trailingWhitespace = trailingWhitespaceMatch[0];
			markers.push({
				message: "Trailing whitespace",
				severity: "warning",
				startLineNumber: lineNumber,
				startColumn: line.length - trailingWhitespace.length + 1,
				endLineNumber: lineNumber,
				endColumn: line.length + 1,
				source: "document-tools",
			});
		}

		const tabIndex = line.indexOf("\t");
		if (tabIndex >= 0) {
			markers.push({
				message: "Tab indentation detected",
				severity: "info",
				startLineNumber: lineNumber,
				startColumn: tabIndex + 1,
				endLineNumber: lineNumber,
				endColumn: tabIndex + 2,
				source: "document-tools",
			});
		}
	}

	return markers;
}

export function buildDocumentHover(lineContent: string, column: number) {
	const headingMatch = lineContent.match(/^(#{1,6})\s+(.+)/);
	if (headingMatch) {
		const title = headingMatch[2].trim();
		const headingLevel = headingMatch[1].length;
		const headingStartColumn = headingMatch[1].length + 2;
		if (column >= headingStartColumn && column <= lineContent.length + 1) {
			return {
				value: `Markdown heading level ${headingLevel}\n\n${title}`,
				startColumn: headingStartColumn,
				endColumn: lineContent.length + 1,
			} satisfies SerializableHoverData;
		}
	}

	const todoMatch = lineContent.match(/\b(TODO|FIXME)\b/);
	if (todoMatch && todoMatch.index !== undefined) {
		const startColumn = todoMatch.index + 1;
		const endColumn = startColumn + todoMatch[0].length;
		if (column >= startColumn && column <= endColumn) {
			return {
				value: `${todoMatch[0]} marker\n\nUse this to track follow-up work in the current file.`,
				startColumn,
				endColumn,
			} satisfies SerializableHoverData;
		}
	}

	return null;
}
