import * as React from "react";

import type { NativeContextMenuItem } from "@/lib/native-context-menu";
import { ensureMonacoSetup } from "@/lib/monaco/monaco-setup";
import { getModel, syncModel, updateModelContent } from "@/lib/monaco/model-store";
import { cn } from "@/lib/utils";

import type { ActiveFileState } from "@/lib/project-files";
import type * as Monaco from "monaco-editor";

function getCanvasLineNumbersMinChars() {
	return 4;
}

interface MonacoEditorProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
	activeFile: ActiveFileState;
	onChange: (content: string) => void;
	onSave: () => void | Promise<void>;
}

function buildEditorContextMenuItems(
	activeFile: ActiveFileState,
	hasSelection: boolean,
): NativeContextMenuItem[] {
	const isWritable = activeFile.permissions.write;

	return [
		{ type: "action", id: "undo", label: "Undo", accelerator: "CmdOrCtrl+Z" },
		{ type: "action", id: "redo", label: "Redo", accelerator: "CmdOrCtrl+Shift+Z" },
		{ type: "separator" },
		{
			type: "action",
			id: "cut",
			label: "Cut",
			accelerator: "CmdOrCtrl+X",
			enabled: isWritable && hasSelection,
		},
		{
			type: "action",
			id: "copy",
			label: "Copy",
			accelerator: "CmdOrCtrl+C",
			enabled: hasSelection,
		},
		{
			type: "action",
			id: "paste",
			label: "Paste",
			accelerator: "CmdOrCtrl+V",
			enabled: isWritable,
		},
		{ type: "separator" },
		{
			type: "action",
			id: "select-all",
			label: "Select All",
			accelerator: "CmdOrCtrl+A",
		},
		{
			type: "action",
			id: "save",
			label: "Save",
			accelerator: "CmdOrCtrl+S",
			enabled: isWritable,
		},
	];
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
	const activeFileRef = React.useRef(activeFile);
	const onChangeRef = React.useRef(onChange);
	const onSaveRef = React.useRef(onSave);
	const [editorReady, setEditorReady] = React.useState(false);
	const viewStatesRef = React.useRef(
		new Map<string, Monaco.editor.ICodeEditorViewState | null>(),
	);

	onChangeRef.current = onChange;
	onSaveRef.current = onSave;
	activeFileRef.current = activeFile;

	React.useEffect(() => {
		let disposed = false;

		void ensureMonacoSetup().then((monaco) => {
			if (disposed || !containerRef.current || editorRef.current) {
				return;
			}

			monacoRef.current = monaco;
			const editor = monaco.editor.create(containerRef.current, {
				automaticLayout: true,
				contextmenu: !window.nativeContextMenu,
				fontFamily:
					'ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
				fontSize: 13,
				lineNumbersMinChars: getCanvasLineNumbersMinChars(),
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

			editor.onContextMenu((event) => {
				const nativeContextMenu = window.nativeContextMenu;
				if (!nativeContextMenu) {
					return;
				}

				event.event.preventDefault();
				event.event.stopPropagation();
				const selection = editor.getSelection();
				const hasSelection = Boolean(selection && !selection.isEmpty());

				if (event.target.position) {
					editor.setPosition(event.target.position);
				}

				void nativeContextMenu
					.showMenu({
						items: buildEditorContextMenuItems(activeFileRef.current, hasSelection),
						x: event.event.posx,
						y: event.event.posy,
					})
					.then((actionId) => {
						if (!actionId) {
							return;
						}

						editor.focus();
						switch (actionId) {
							case "undo":
								editor.trigger("native-context-menu", "undo", null);
								break;
							case "redo":
								editor.trigger("native-context-menu", "redo", null);
								break;
							case "cut":
								editor.trigger(
									"native-context-menu",
									"editor.action.clipboardCutAction",
									null,
								);
								break;
							case "copy":
								editor.trigger(
									"native-context-menu",
									"editor.action.clipboardCopyAction",
									null,
								);
								break;
							case "paste":
								editor.trigger(
									"native-context-menu",
									"editor.action.clipboardPasteAction",
									null,
								);
								break;
							case "select-all":
								editor.trigger("native-context-menu", "editor.action.selectAll", null);
								break;
							case "save":
								void onSaveRef.current();
								break;
							default:
								break;
						}
					});
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
		const container = containerRef.current;
		if (!editor || !container || typeof ResizeObserver === "undefined") {
			return;
		}

		const observer = new ResizeObserver(() => {
			editor.layout();
		});

		observer.observe(container);

		return () => {
			observer.disconnect();
		};
	}, [editorReady]);

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

	return (
		<div
			ref={containerRef}
			className={cn("monaco-canvas-editor h-full min-w-0 w-full", className)}
			{...props}
		/>
	);
}
