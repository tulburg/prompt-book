export interface ParsedContextFile {
	filename: string;
	title: string;
	description: string;
	paragraphs: string[];
	content: string;
}

function humanizeFilename(filename: string): string {
	const baseName = filename.replace(/\.md$/i, "");
	if (!baseName) {
		return "Untitled Context";
	}
	return baseName
		.split(/[-_.]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function normalizeContextFilename(filename: string): string {
	const trimmed = filename.trim();
	if (!trimmed) {
		throw new Error("Context filename is required.");
	}
	if (trimmed.includes("/") || trimmed.includes("\\")) {
		throw new Error("Context filename must not include directory separators.");
	}
	if (!/^[a-zA-Z0-9._-]+\.md$/i.test(trimmed)) {
		throw new Error("Context filename must be a markdown filename like codebase.md.");
	}
	return trimmed;
}

export function parseContextMarkdown(filename: string, content: string): ParsedContextFile {
	const normalizedContent = content.replace(/\r\n/g, "\n").trim();
	const titleMatch = normalizedContent.match(/^#\s+(.+)$/m);
	const title = titleMatch?.[1]?.trim() || humanizeFilename(filename);

	const afterTitle = titleMatch
		? normalizedContent.slice((titleMatch.index ?? 0) + titleMatch[0].length).trim()
		: normalizedContent;
	const logHeadingIndex = afterTitle.indexOf("## Context Log");
	const descriptionBlock =
		logHeadingIndex >= 0 ? afterTitle.slice(0, logHeadingIndex).trim() : afterTitle.trim();
	const description = descriptionBlock
		.split(/\n{2,}/)
		.map((entry) => entry.trim().replace(/\s+/g, " "))
		.find(Boolean) ?? "";

	const logBlock =
		logHeadingIndex >= 0
			? afterTitle.slice(logHeadingIndex + "## Context Log".length).trim()
			: "";
	const paragraphs = logBlock
		.split(/\n{2,}/)
		.map((entry) => entry.trim())
		.filter(Boolean);

	return {
		filename,
		title,
		description,
		paragraphs,
		content: normalizedContent,
	};
}

export function serializeContextMarkdown(input: {
	title: string;
	description: string;
	paragraphs: string[];
}): string {
	const title = input.title.trim();
	const description = input.description.trim();
	const paragraphs = input.paragraphs.map((entry) => entry.trim()).filter(Boolean);

	const sections = [`# ${title}`];
	if (description) {
		sections.push(description);
	}
	sections.push("## Context Log");
	if (paragraphs.length > 0) {
		sections.push(paragraphs.join("\n\n"));
	}

	return `${sections.join("\n\n").trim()}\n`;
}
