import setiTheme from "./icons/vs-seti-icon-theme.json";
import setiFontUrl from "./icons/seti.woff";

interface SetiIconDefinition {
	fontCharacter: string;
	fontColor: string;
}

interface SetiTheme {
	fonts: { id: string; src: { path: string; format: string }[]; size: string }[];
	iconDefinitions: Record<string, SetiIconDefinition>;
	file: string;
	fileExtensions: Record<string, string>;
	fileNames: Record<string, string>;
	languageIds: Record<string, string>;
	light: {
		file: string;
		fileExtensions: Record<string, string>;
		fileNames: Record<string, string>;
		languageIds: Record<string, string>;
	};
}

const theme = setiTheme as unknown as SetiTheme;
const LANGUAGE_ID_BY_EXTENSION: Record<string, string> = {
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascriptreact",
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "typescriptreact",
	json: "json",
	jsonc: "jsonc",
	jsonl: "jsonl",
	css: "css",
	scss: "scss",
	less: "less",
	html: "html",
	htm: "html",
	md: "markdown",
	yml: "yaml",
	yaml: "yaml",
	xml: "xml",
	svg: "xml",
	sh: "shellscript",
	bash: "shellscript",
	sql: "sql",
	py: "python",
	rb: "ruby",
	rs: "rust",
	go: "go",
	java: "java",
	php: "php",
	vue: "vue",
	svelte: "svelte",
	toml: "properties",
	env: "dotenv",
};

let styleInjected = false;

export function injectSetiFont(): void {
	if (styleInjected) return;
	styleInjected = true;

	const style = document.createElement("style");
	style.textContent = `
@font-face {
	font-family: "seti";
	src: url("${setiFontUrl}") format("woff");
	font-weight: normal;
	font-style: normal;
}
`;
	document.head.appendChild(style);
}

export interface FileIconResult {
	character: string;
	color: string;
}

export function toSetiGlyph(fontCharacter: string): string {
	const hexCode = fontCharacter.replace(/^\\/, "");
	const codePoint = Number.parseInt(hexCode, 16);

	if (Number.isNaN(codePoint)) {
		return "";
	}

	return String.fromCodePoint(codePoint);
}

function getDefinition(id: string): SetiIconDefinition | null {
	return theme.iconDefinitions[id] ?? null;
}

function inferLanguageId(fileName: string): string | null {
	const lowerName = fileName.toLowerCase();

	if (lowerName.endsWith(".d.ts")) {
		return "typescript";
	}

	const parts = lowerName.split(".");
	for (let i = 1; i < parts.length; i++) {
		const ext = parts.slice(i).join(".");
		const languageId = LANGUAGE_ID_BY_EXTENSION[ext];
		if (languageId) {
			return languageId;
		}
	}

	return null;
}

export function resolveFileIcon(
	fileName: string,
	isDirectory: boolean,
): FileIconResult | null {
	if (isDirectory) return null;

	const lowerName = fileName.toLowerCase();

	const byName = theme.fileNames[lowerName];
	if (byName) {
		const def = getDefinition(byName);
		if (def) return { character: def.fontCharacter, color: def.fontColor };
	}

	const parts = lowerName.split(".");
	for (let i = 1; i < parts.length; i++) {
		const ext = parts.slice(i).join(".");
		const byExt = theme.fileExtensions[ext];
		if (byExt) {
			const def = getDefinition(byExt);
			if (def) return { character: def.fontCharacter, color: def.fontColor };
		}
	}

	const languageId = inferLanguageId(lowerName);
	if (languageId) {
		const byLanguage = theme.languageIds[languageId];
		if (byLanguage) {
			const def = getDefinition(byLanguage);
			if (def) return { character: def.fontCharacter, color: def.fontColor };
		}
	}

	const defaultId = theme.file;
	const def = getDefinition(defaultId);
	if (def) return { character: def.fontCharacter, color: def.fontColor };

	return null;
}
