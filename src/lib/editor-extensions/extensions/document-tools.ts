import { buildDocumentHover } from "@/lib/editor-extensions/extensions/document-tools.shared";
import type { EditorExtensionDefinition } from "@/lib/editor-extensions/registry";

const SUPPORTED_LANGUAGES = [
	"plaintext",
	"markdown",
	"javascript",
	"javascriptreact",
	"typescript",
	"typescriptreact",
	"json",
	"css",
	"html",
];

export const documentToolsExtension: EditorExtensionDefinition = {
	manifest: {
		id: "document-tools",
		name: "Document Tools",
		languages: SUPPORTED_LANGUAGES,
		capabilities: {
			completionItems: "worker",
			diagnostics: "worker",
			hover: "direct",
		},
	},
	completionProvider: {
		execution: "worker",
		triggerCharacters: ["_", "-"],
	},
	hoverProvider: {
		execution: "direct",
		provideHover({ model, position }) {
			return buildDocumentHover(model.getLineContent(position.lineNumber), position.column);
		},
	},
	diagnosticsProvider: {
		execution: "worker",
	},
};
