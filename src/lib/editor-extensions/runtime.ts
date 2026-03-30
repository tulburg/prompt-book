import { documentToolsExtension } from "@/lib/editor-extensions/extensions/document-tools";
import { EditorExtensionWorkerClient } from "@/lib/editor-extensions/worker-client";
import { createEditorExtensionRegistry } from "@/lib/editor-extensions/registry";

import type * as Monaco from "monaco-editor";

type MonacoModule = typeof Monaco;

const DIAGNOSTICS_OWNER = "prompt-book-builtins";
const DIAGNOSTICS_DEBOUNCE_MS = 150;

export function createEditorExtensionRuntime(monaco: MonacoModule) {
	const registry = createEditorExtensionRegistry([documentToolsExtension]);
	const workerClient = new EditorExtensionWorkerClient();
	const disposables: Monaco.IDisposable[] = [];
	const diagnosticsListeners = new Map<string, Monaco.IDisposable>();
	const diagnosticsTimers = new Map<string, number>();

	function clearDiagnosticsTimer(modelUri: string) {
		const timerId = diagnosticsTimers.get(modelUri);
		if (timerId !== undefined) {
			window.clearTimeout(timerId);
			diagnosticsTimers.delete(modelUri);
		}
	}

	async function runDiagnostics(model: Monaco.editor.ITextModel) {
		const matchingExtensions = registry
			.getMatchingExtensions(model)
			.filter((extension) => extension.diagnosticsProvider);

		if (matchingExtensions.length === 0) {
			monaco.editor.setModelMarkers(model, DIAGNOSTICS_OWNER, []);
			return;
		}

		const markerGroups = await Promise.all(
			matchingExtensions.map(async (extension) => {
				const diagnosticsProvider = extension.diagnosticsProvider;
				if (!diagnosticsProvider) {
					return [];
				}

				if (diagnosticsProvider.execution === "worker") {
					const workerMarkers = await workerClient.request({
						capability: "diagnostics",
						extensionId: extension.manifest.id,
						languageId: model.getLanguageId(),
						modelValue: model.getValue(),
					});
					return workerMarkers.map((marker) => ({
						...marker,
						severity:
							marker.severity === "error"
								? monaco.MarkerSeverity.Error
								: marker.severity === "info"
									? monaco.MarkerSeverity.Info
									: monaco.MarkerSeverity.Warning,
					}));
				}

				const directMarkers = await diagnosticsProvider.provideDiagnostics({
					model,
					monaco,
				});
				return directMarkers.map((marker) => ({
					...marker,
					severity:
						marker.severity === "error"
							? monaco.MarkerSeverity.Error
							: marker.severity === "info"
								? monaco.MarkerSeverity.Info
								: monaco.MarkerSeverity.Warning,
				}));
			}),
		);

		monaco.editor.setModelMarkers(model, DIAGNOSTICS_OWNER, markerGroups.flat());
	}

	function scheduleDiagnostics(model: Monaco.editor.ITextModel) {
		const modelUri = model.uri.toString();
		clearDiagnosticsTimer(modelUri);
		const timerId = window.setTimeout(() => {
			void runDiagnostics(model);
		}, DIAGNOSTICS_DEBOUNCE_MS);
		diagnosticsTimers.set(modelUri, timerId);
	}

	function attachDiagnostics(model: Monaco.editor.ITextModel) {
		const modelUri = model.uri.toString();
		if (diagnosticsListeners.has(modelUri)) {
			return;
		}

		const disposable = model.onDidChangeContent(() => {
			scheduleDiagnostics(model);
		});

		diagnosticsListeners.set(modelUri, disposable);
		void runDiagnostics(model);
	}

	function detachDiagnostics(model: Monaco.editor.ITextModel) {
		const modelUri = model.uri.toString();
		diagnosticsListeners.get(modelUri)?.dispose();
		diagnosticsListeners.delete(modelUri);
		clearDiagnosticsTimer(modelUri);
	}

	for (const extension of registry.getAll()) {
		for (const language of extension.manifest.languages) {
			if (extension.completionProvider) {
				const completionProvider = extension.completionProvider;
				disposables.push(
					monaco.languages.registerCompletionItemProvider(language, {
						triggerCharacters: completionProvider.triggerCharacters,
						async provideCompletionItems(model, position) {
							if (!registry.getMatchingExtensions(model).includes(extension)) {
								return { suggestions: [] };
							}

							const currentWordInfo = model.getWordUntilPosition(position);
							const currentWord = currentWordInfo.word;
							const range = new monaco.Range(
								position.lineNumber,
								currentWordInfo.startColumn,
								position.lineNumber,
								currentWordInfo.endColumn,
							);
							const suggestions =
								completionProvider.execution === "worker"
									? await workerClient.request({
											capability: "completionItems",
											currentWord,
											extensionId: extension.manifest.id,
											languageId: model.getLanguageId(),
											modelValue: model.getValue(),
										})
									: await completionProvider.provideCompletionItems({
											currentWord,
											model,
											monaco,
											position,
										});

							return {
								suggestions: suggestions.map((suggestion: (typeof suggestions)[number]) => ({
									detail: suggestion.detail,
									documentation: suggestion.documentation,
									insertText: suggestion.insertText,
									kind: monaco.languages.CompletionItemKind.Text,
									label: suggestion.label,
									range,
								})),
							};
						},
					}),
				);
			}

			if (extension.hoverProvider) {
				disposables.push(
					monaco.languages.registerHoverProvider(language, {
						async provideHover(model, position) {
							if (!registry.getMatchingExtensions(model).includes(extension)) {
								return null;
							}

							const hover = await extension.hoverProvider?.provideHover({
								model,
								monaco,
								position,
							});
							if (!hover) {
								return null;
							}

							return {
								contents: [{ value: hover.value }],
								range: new monaco.Range(
									position.lineNumber,
									hover.startColumn,
									position.lineNumber,
									hover.endColumn,
								),
							};
						},
					}),
				);
			}
		}
	}

	disposables.push(
		monaco.editor.onDidCreateModel((model) => {
			attachDiagnostics(model);
		}),
	);
	disposables.push(
		monaco.editor.onDidChangeModelLanguage((event) => {
			detachDiagnostics(event.model);
			attachDiagnostics(event.model);
		}),
	);
	disposables.push(
		monaco.editor.onWillDisposeModel((model) => {
			detachDiagnostics(model);
		}),
	);

	for (const model of monaco.editor.getModels()) {
		attachDiagnostics(model);
	}

	return {
		dispose() {
			for (const timerId of diagnosticsTimers.values()) {
				window.clearTimeout(timerId);
			}
			diagnosticsTimers.clear();

			for (const listener of diagnosticsListeners.values()) {
				listener.dispose();
			}
			diagnosticsListeners.clear();

			for (const disposable of disposables) {
				disposable.dispose();
			}

			workerClient.dispose();
		},
	};
}
