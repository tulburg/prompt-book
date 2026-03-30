import * as React from "react";

import { ensureMonacoSetup } from "@/lib/monaco/monaco-setup";
import { getModel, syncModel, updateModelContent } from "@/lib/monaco/model-store";
import { cn } from "@/lib/utils";

import type { ActiveFileState } from "@/lib/project-files";
import type * as Monaco from "monaco-editor";

interface MonacoEditorProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
	activeFile: ActiveFileState;
	onChange: (content: string) => void;
	onSave: () => void | Promise<void>;
}

export function MonacoEditor({
	activeFile,
	className,
	onChange,
	onSave,
	...props
}: MonacoEditorProps) {
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	const editorRef = React.useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
	const monacoRef = React.useRef<typeof Monaco | null>(null);
	const isApplyingExternalState = React.useRef(false);
	const activePathRef = React.useRef<string | null>(null);
	const onChangeRef = React.useRef(onChange);
	const onSaveRef = React.useRef(onSave);
	const [editorReady, setEditorReady] = React.useState(false);
	const viewStatesRef = React.useRef(
		new Map<string, Monaco.editor.ICodeEditorViewState | null>(),
	);

	onChangeRef.current = onChange;
	onSaveRef.current = onSave;

	React.useEffect(() => {
		let disposed = false;

		void ensureMonacoSetup().then((monaco) => {
			if (disposed || !containerRef.current || editorRef.current) {
				return;
			}

			monacoRef.current = monaco;
			const editor = monaco.editor.create(containerRef.current, {
				automaticLayout: true,
				fontFamily:
					'ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
				fontSize: 13,
				lineNumbersMinChars: 3,
				minimap: { enabled: false },
				padding: { bottom: 16, top: 16 },
				readOnly: !activeFile.permissions.write,
				renderLineHighlight: "gutter",
				scrollBeyondLastLine: false,
				smoothScrolling: true,
				tabSize: 2,
				wordWrap: "on",
			});

			editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
				void onSaveRef.current();
			});

			editor.onDidChangeModelContent(() => {
				if (isApplyingExternalState.current) {
					return;
				}

				const model = editor.getModel();
				if (!model) {
					return;
				}

				onChangeRef.current(model.getValue());
			});

			editorRef.current = editor;
			setEditorReady(true);
		});

		return () => {
			disposed = true;
			const editor = editorRef.current;
			const model = activePathRef.current ? getModel(activePathRef.current) : null;
			if (editor && activePathRef.current && model) {
				viewStatesRef.current.set(activePathRef.current, editor.saveViewState());
			}
			editorRef.current?.dispose();
			editorRef.current = null;
			monacoRef.current = null;
			setEditorReady(false);
		};
	}, []);

	React.useEffect(() => {
		const editor = editorRef.current;
		if (!editor) {
			return;
		}

		const previousPath = activePathRef.current;
		if (previousPath && previousPath !== activeFile.path) {
			viewStatesRef.current.set(previousPath, editor.saveViewState());
		}

		activePathRef.current = activeFile.path;
		isApplyingExternalState.current = true;
		const model = syncModel(activeFile.path, activeFile.content);
		if (model && editor.getModel() !== model) {
			editor.setModel(model);
		}
		updateModelContent(activeFile.path, activeFile.content);
		editor.updateOptions({ readOnly: !activeFile.permissions.write });

		const nextViewState = viewStatesRef.current.get(activeFile.path);
		if (nextViewState) {
			editor.restoreViewState(nextViewState);
		} else {
			editor.revealPositionInCenter({ column: 1, lineNumber: 1 });
		}

		editor.focus();
		isApplyingExternalState.current = false;
	}, [activeFile.content, activeFile.path, activeFile.permissions.write, editorReady]);

	return <div ref={containerRef} className={cn("h-full w-full", className)} {...props} />;
}
