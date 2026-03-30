import { createEditorExtensionRuntime } from "@/lib/editor-extensions/runtime";
import { registerMonacoInstance } from "@/lib/monaco/model-store";

import type * as Monaco from "monaco-editor";

type MonacoModule = typeof Monaco;
type MonacoWorkerConstructor = new () => Worker;

let monacoPromise: Promise<MonacoModule> | null = null;
let editorExtensionRuntimePromise: Promise<
  ReturnType<typeof createEditorExtensionRuntime>
> | null = null;

function createTheme(monaco: MonacoModule) {
  monaco.editor.defineTheme("prompt-book-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#141414",
      "editor.foreground": "#cccccc",
      "editor.lineHighlightBackground": "#1b1b1b",
      "editorLineNumber.foreground": "#6b7280",
      "editorLineNumber.activeForeground": "#d8dee9",
      "editorCursor.foreground": "#60a5fa",
      "editor.selectionBackground": "#1d4ed833",
      "editor.inactiveSelectionBackground": "#33415540",
    },
  });

  monaco.editor.setTheme("prompt-book-dark");
}

async function initializeExtensionRuntime(monaco: MonacoModule) {
  if (!editorExtensionRuntimePromise) {
    editorExtensionRuntimePromise = Promise.resolve(
      createEditorExtensionRuntime(monaco),
    );
  }

  return editorExtensionRuntimePromise;
}

export async function ensureMonacoSetup() {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      const [
        monaco,
        editorWorker,
        jsonWorker,
        cssWorker,
        htmlWorker,
        tsWorker,
      ] = await Promise.all([
        import("monaco-editor"),
        import("monaco-editor/esm/vs/editor/editor.worker?worker"),
        import("monaco-editor/esm/vs/language/json/json.worker?worker"),
        import("monaco-editor/esm/vs/language/css/css.worker?worker"),
        import("monaco-editor/esm/vs/language/html/html.worker?worker"),
        import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
      ]);

      const workerMap: Record<string, MonacoWorkerConstructor> = {
        css: cssWorker.default,
        html: htmlWorker.default,
        javascript: tsWorker.default,
        json: jsonWorker.default,
        typescript: tsWorker.default,
      };

      globalThis.MonacoEnvironment = {
        getWorker(_workerId: string, label: string) {
          const WorkerConstructor = workerMap[label] ?? editorWorker.default;
          return new WorkerConstructor();
        },
      };

      registerMonacoInstance(monaco);
      createTheme(monaco);
      await initializeExtensionRuntime(monaco);
      return monaco;
    })();
  }

  return monacoPromise;
}
