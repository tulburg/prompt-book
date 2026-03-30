import type * as Monaco from "monaco-editor";

import type {
	SerializableCompletionItem,
	SerializableHoverData,
	SerializableMarkerData,
} from "@/lib/editor-extensions/extensions/document-tools.shared";

type MonacoModule = typeof Monaco;

export type ExtensionExecutionMode = "direct" | "worker";
export type ExtensionCapability =
	| "codeActions"
	| "completionItems"
	| "diagnostics"
	| "formatting"
	| "hover";

export interface EditorExtensionManifest {
	id: string;
	name: string;
	languages: string[];
	filePatterns?: RegExp[];
	capabilities: Partial<Record<ExtensionCapability, ExtensionExecutionMode>>;
}

export interface ExtensionDocumentContext {
	model: Monaco.editor.ITextModel;
	monaco: MonacoModule;
}

export interface ExtensionCompletionContext extends ExtensionDocumentContext {
	currentWord: string;
	position: Monaco.Position;
}

export interface ExtensionHoverContext extends ExtensionDocumentContext {
	position: Monaco.Position;
}

export interface WorkerBackedProviderConfig {
	execution: "worker";
}

export interface DirectCompletionProviderConfig {
	execution: "direct";
	triggerCharacters?: string[];
	provideCompletionItems: (
		context: ExtensionCompletionContext,
	) => SerializableCompletionItem[] | Promise<SerializableCompletionItem[]>;
}

export interface WorkerCompletionProviderConfig extends WorkerBackedProviderConfig {
	triggerCharacters?: string[];
}

export interface DirectHoverProviderConfig {
	execution: "direct";
	provideHover: (
		context: ExtensionHoverContext,
	) => SerializableHoverData | null | Promise<SerializableHoverData | null>;
}

export interface DirectDiagnosticsProviderConfig {
	execution: "direct";
	provideDiagnostics: (
		context: ExtensionDocumentContext,
	) => SerializableMarkerData[] | Promise<SerializableMarkerData[]>;
}

export interface WorkerDiagnosticsProviderConfig extends WorkerBackedProviderConfig {}

export interface EditorExtensionDefinition {
	manifest: EditorExtensionManifest;
	completionProvider?: DirectCompletionProviderConfig | WorkerCompletionProviderConfig;
	hoverProvider?: DirectHoverProviderConfig;
	diagnosticsProvider?: DirectDiagnosticsProviderConfig | WorkerDiagnosticsProviderConfig;
}

interface MatchableModel {
	getLanguageId(): string;
	uri: {
		path: string;
	};
}

export function matchesExtensionManifest(
	manifest: EditorExtensionManifest,
	model: MatchableModel,
) {
	if (manifest.languages.length > 0 && !manifest.languages.includes(model.getLanguageId())) {
		return false;
	}

	if (!manifest.filePatterns || manifest.filePatterns.length === 0) {
		return true;
	}

	return manifest.filePatterns.some((filePattern) => filePattern.test(model.uri.path));
}

export function createEditorExtensionRegistry(extensions: EditorExtensionDefinition[]) {
	return {
		getAll() {
			return extensions;
		},
		getMatchingExtensions(model: MatchableModel) {
			return extensions.filter((extension) =>
				matchesExtensionManifest(extension.manifest, model),
			);
		},
	};
}
