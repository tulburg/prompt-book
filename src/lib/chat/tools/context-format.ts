export interface ParsedContextFile {
	filename: string;
	title: string;
	description: string;
	pointers: string[];
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
		throw new Error("Context filename must be a valid markdown filename ending in .md.");
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
	const mapHeadingIndex = afterTitle.indexOf("## Context Map");
	const legacyLogIndex = afterTitle.indexOf("## Context Log");
	const sectionIndex = mapHeadingIndex >= 0 ? mapHeadingIndex : legacyLogIndex;
	const sectionHeading = mapHeadingIndex >= 0 ? "## Context Map" : "## Context Log";
	const descriptionBlock =
		sectionIndex >= 0 ? afterTitle.slice(0, sectionIndex).trim() : afterTitle.trim();
	const description = descriptionBlock
		.split(/\n{2,}/)
		.map((entry) => entry.trim().replace(/\s+/g, " "))
		.find(Boolean) ?? "";

	const mapBlock =
		sectionIndex >= 0
			? afterTitle.slice(sectionIndex + sectionHeading.length).trim()
			: "";
	const pointers = mapBlock
		.split(/\n{2,}/)
		.map((entry) => entry.trim())
		.filter(Boolean);

	return {
		filename,
		title,
		description,
		pointers,
		content: normalizedContent,
	};
}

export function serializeContextMarkdown(input: {
	title: string;
	description: string;
	pointers: string[];
}): string {
	const title = input.title.trim();
	const description = input.description.trim();
	const pointers = input.pointers.map((entry) => entry.trim()).filter(Boolean);

	const sections = [`# ${title}`];
	if (description) {
		sections.push(description);
	}
	sections.push("## Context Map");
	if (pointers.length > 0) {
		sections.push(pointers.join("\n\n"));
	}

	return `${sections.join("\n\n").trim()}\n`;
}
