import * as React from "react";

import { ensureMonacoSetup } from "@/lib/monaco/monaco-setup";
import { cn } from "@/lib/utils";
import { getLanguageIdForPath } from "@/lib/monaco/model-store";
import type * as Monaco from "monaco-editor";

type MonacoModule = typeof Monaco;

function getMonacoHeight(value: string, maxHeight: number, lineHeight = 18) {
  const lineCount = Math.max(1, value.split("\n").length);
  return Math.min(maxHeight, lineCount * lineHeight + 24);
}

function applyTinyScrollbarOptions() {
  return {
    alwaysConsumeMouseWheel: false,
    horizontalScrollbarSize: 8,
    useShadows: false,
    verticalScrollbarSize: 8,
  } satisfies Monaco.editor.IEditorScrollbarOptions;
}

function getInternalPadding() {
  return { top: 10, bottom: 14 };
}

function getLineNumbersMinChars(lineNumbers?: string[]) {
  if (!lineNumbers) {
    return 4;
  }
  return Math.max(
    4,
    lineNumbers.reduce(
      (max, lineNumber) => Math.max(max, lineNumber.length),
      0,
    ) + 1,
  );
}

function parseEmbeddedLineNumbers(value: string): {
  displayValue: string;
  lineNumbers?: string[];
} {
  const rawLines = value.split("\n");
  const sampledLines = rawLines
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (sampledLines.length < 2) {
    return { displayValue: value };
  }

  const numberedSampleCount = sampledLines.filter((line) =>
    /^\s*\d+\|/.test(line),
  ).length;
  const looksNumbered =
    numberedSampleCount >= Math.max(2, Math.ceil(sampledLines.length * 0.6));

  if (!looksNumbered) {
    return { displayValue: value };
  }

  const parsedLines = rawLines.map((line) => {
    const match = line.match(/^\s*(\d+)\|(.*)$/);
    if (!match) {
      return { content: line, lineNumber: undefined as string | undefined };
    }
    return {
      content: match[2] ?? "",
      lineNumber: match[1],
    };
  });

  return {
    displayValue: parsedLines.map((line) => line.content).join("\n"),
    lineNumbers: parsedLines.map((line) => line.lineNumber ?? ""),
  };
}

interface MonacoCodeViewProps {
  value: string;
  filePath?: string;
  language?: string;
  className?: string;
  maxHeight?: number;
}

export function MonacoCodeView({
  value,
  filePath,
  language,
  className,
  maxHeight = 300,
}: MonacoCodeViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<Monaco.editor.IStandaloneCodeEditor | null>(
    null,
  );
  const modelRef = React.useRef<Monaco.editor.ITextModel | null>(null);

  const resolvedLanguage = React.useMemo(() => {
    if (language) return language;
    if (filePath) return getLanguageIdForPath(filePath);
    return "plaintext";
  }, [filePath, language]);
  const normalizedValue = React.useMemo(
    () => parseEmbeddedLineNumbers(value),
    [value],
  );

  const height = React.useMemo(
    () => getMonacoHeight(normalizedValue.displayValue, maxHeight),
    [maxHeight, normalizedValue.displayValue],
  );
  const lineNumbersOption = React.useMemo(() => {
    if (normalizedValue.lineNumbers) {
      return (lineNumber: number) =>
        normalizedValue.lineNumbers?.[lineNumber - 1] || "";
    }
    return normalizedValue.displayValue.includes("\n") ? "on" : "off";
  }, [normalizedValue.displayValue, normalizedValue.lineNumbers]);
  const lineNumbersMinChars = React.useMemo(() => {
    return getLineNumbersMinChars(normalizedValue.lineNumbers);
  }, [normalizedValue.lineNumbers]);

  React.useEffect(() => {
    let disposed = false;

    void ensureMonacoSetup().then((monaco: MonacoModule) => {
      if (disposed || !containerRef.current || editorRef.current) {
        return;
      }

      const model = monaco.editor.createModel(
        normalizedValue.displayValue,
        resolvedLanguage,
      );
      modelRef.current = model;

      const editor = monaco.editor.create(containerRef.current, {
        automaticLayout: true,
        contextmenu: false,
        folding: false,
        fontFamily:
          'ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: 11.5,
        glyphMargin: false,
        lineDecorationsWidth: 8,
        lineHeight: 18,
        lineNumbers: lineNumbersOption,
        lineNumbersMinChars,
        minimap: { enabled: false },
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        padding: getInternalPadding(),
        readOnly: true,
        renderFinalNewline: "off",
        renderLineHighlight: "none",
        roundedSelection: false,
        scrollBeyondLastLine: false,
        scrollbar: applyTinyScrollbarOptions(),
        stickyScroll: { enabled: false },
        wordWrap: "off",
      });

      editor.setModel(model);
      editorRef.current = editor;
    });

    return () => {
      disposed = true;
      editorRef.current?.dispose();
      modelRef.current?.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) return;

    if (model.getValue() !== normalizedValue.displayValue) {
      model.setValue(normalizedValue.displayValue);
    }
    editor.updateOptions({
      lineNumbers: lineNumbersOption,
      lineNumbersMinChars,
    });
    editor.layout();
  }, [
    lineNumbersMinChars,
    lineNumbersOption,
    normalizedValue.displayValue,
    resolvedLanguage,
  ]);

  React.useEffect(() => {
    let cancelled = false;
    void ensureMonacoSetup().then((monaco: MonacoModule) => {
      if (cancelled || !modelRef.current) return;
      if (modelRef.current.getLanguageId() !== resolvedLanguage) {
        monaco.editor.setModelLanguage(modelRef.current, resolvedLanguage);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedLanguage]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "monaco-readonly-view overflow-hidden bg-panel-600/70",
        className,
      )}
      style={{ height }}
    />
  );
}

interface MonacoDiffViewProps {
  originalValue: string;
  modifiedValue: string;
  filePath?: string;
  language?: string;
  className?: string;
  maxHeight?: number;
}

export function MonacoDiffView({
  originalValue,
  modifiedValue,
  filePath,
  language,
  className,
  maxHeight = 400,
}: MonacoDiffViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const diffEditorRef = React.useRef<Monaco.editor.IStandaloneDiffEditor | null>(
    null,
  );
  const originalModelRef = React.useRef<Monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = React.useRef<Monaco.editor.ITextModel | null>(null);

  const resolvedLanguage = React.useMemo(() => {
    if (language) return language;
    if (filePath) return getLanguageIdForPath(filePath);
    return "plaintext";
  }, [filePath, language]);

  const height = React.useMemo(() => {
    const longest = Math.max(
      originalValue.split("\n").length,
      modifiedValue.split("\n").length,
    );
    return Math.min(maxHeight, Math.max(120, longest * 18 + 24));
  }, [maxHeight, modifiedValue, originalValue]);

  React.useEffect(() => {
    let disposed = false;

    void ensureMonacoSetup().then((monaco: MonacoModule) => {
      if (disposed || !containerRef.current || diffEditorRef.current) {
        return;
      }

      originalModelRef.current = monaco.editor.createModel(
        originalValue,
        resolvedLanguage,
      );
      modifiedModelRef.current = monaco.editor.createModel(
        modifiedValue,
        resolvedLanguage,
      );

      const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
        automaticLayout: true,
        contextmenu: false,
        enableSplitViewResizing: false,
        fontFamily:
          'ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: 11.5,
        glyphMargin: false,
        lineDecorationsWidth: 8,
        lineHeight: 18,
        minimap: { enabled: false },
        originalEditable: false,
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        readOnly: true,
        renderIndicators: true,
        renderSideBySide: false,
        scrollBeyondLastLine: false,
        scrollbar: applyTinyScrollbarOptions(),
        stickyScroll: { enabled: false },
      });

      diffEditor.setModel({
        original: originalModelRef.current,
        modified: modifiedModelRef.current,
      });
      diffEditorRef.current = diffEditor;
    });

    return () => {
      disposed = true;
      diffEditorRef.current?.dispose();
      originalModelRef.current?.dispose();
      modifiedModelRef.current?.dispose();
      diffEditorRef.current = null;
      originalModelRef.current = null;
      modifiedModelRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const originalModel = originalModelRef.current;
    const modifiedModel = modifiedModelRef.current;
    const diffEditor = diffEditorRef.current;
    if (!originalModel || !modifiedModel || !diffEditor) return;

    if (originalModel.getValue() !== originalValue) {
      originalModel.setValue(originalValue);
    }
    if (modifiedModel.getValue() !== modifiedValue) {
      modifiedModel.setValue(modifiedValue);
    }
    diffEditor.layout();
  }, [modifiedValue, originalValue]);

  React.useEffect(() => {
    let cancelled = false;
    void ensureMonacoSetup().then((monaco: MonacoModule) => {
      if (cancelled) return;
      if (
        originalModelRef.current &&
        originalModelRef.current.getLanguageId() !== resolvedLanguage
      ) {
        monaco.editor.setModelLanguage(
          originalModelRef.current,
          resolvedLanguage,
        );
      }
      if (
        modifiedModelRef.current &&
        modifiedModelRef.current.getLanguageId() !== resolvedLanguage
      ) {
        monaco.editor.setModelLanguage(
          modifiedModelRef.current,
          resolvedLanguage,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedLanguage]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "monaco-readonly-view monaco-readonly-diff overflow-hidden bg-panel-600/70",
        className,
      )}
      style={{ height }}
    />
  );
}
