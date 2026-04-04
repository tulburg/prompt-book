import path from "node:path";

export interface StoredBlockSchema {
	title: string;
	definition: string;
	files: string[];
	diagramPath: string;
	contextPath: string;
}

export interface ParsedBlockSchema extends StoredBlockSchema {
	id: string;
	schemaPath: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeBlockId(blockId: string): string {
	const trimmed = blockId.trim();
	if (!trimmed) {
		throw new Error("Block id is required.");
	}
	if (trimmed.includes("/") || trimmed.includes("\\")) {
		throw new Error("Block id must not include directory separators.");
	}
	if (!/^[a-z0-9._-]+$/i.test(trimmed)) {
		throw new Error("Block id may contain only letters, numbers, dots, underscores, and dashes.");
	}
	return trimmed;
}

function requireString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Block schema field "${fieldName}" must be a non-empty string.`);
	}
	return value.trim();
}

function requireStringArray(value: unknown, fieldName: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`Block schema field "${fieldName}" must be an array of strings.`);
	}
	const normalized = value
		.map((entry) => {
			if (typeof entry !== "string" || !entry.trim()) {
				throw new Error(`Block schema field "${fieldName}" must only contain non-empty strings.`);
			}
			return entry.trim();
		});
	return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

export function parseBlockSchema(
	blockId: string,
	schemaPath: string,
	content: string,
): ParsedBlockSchema {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		throw new Error(`Block schema is not valid JSON: ${schemaPath}`);
	}
	if (!isObject(parsed)) {
		throw new Error(`Block schema must be a JSON object: ${schemaPath}`);
	}

	return {
		id: normalizeBlockId(blockId),
		schemaPath,
		title: requireString(parsed.title, "title"),
		definition: requireString(parsed.definition, "definition"),
		files: requireStringArray(parsed.files, "files"),
		diagramPath: requireString(parsed.diagramPath, "diagramPath"),
		contextPath: requireString(parsed.contextPath, "contextPath"),
	};
}

export function serializeBlockSchema(schema: StoredBlockSchema): string {
	return `${JSON.stringify(
		{
			title: schema.title.trim(),
			definition: schema.definition.trim(),
			files: [...new Set(schema.files.map((filePath) => filePath.trim()).filter(Boolean))].sort(
				(left, right) => left.localeCompare(right),
			),
			diagramPath: schema.diagramPath.trim(),
			contextPath: schema.contextPath.trim(),
		},
		null,
		2,
	)}\n`;
}

export function defaultBlockDiagram(title: string, files: string[]): string {
	const nodes = files.length > 0
		? files
				.map((filePath, index) => {
					const nodeId = `F${index + 1}`;
					const label = path.basename(filePath).replace(/"/g, '\\"');
					return `    ${nodeId}["${label}"]`;
				})
				.join("\n")
		: '    F1["No files registered yet"]';
	const edges = files.length > 0
		? files.map((_filePath, index) => `    Block --> F${index + 1}`).join("\n")
		: "    Block --> F1";
	const safeTitle = title.trim().replace(/"/g, '\\"') || "Block";

	return [
		"flowchart TD",
		`    Block["${safeTitle}"]`,
		nodes,
		edges,
	].join("\n");
}
