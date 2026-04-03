import * as React from "react";
import {
  MonacoCodeView,
  MonacoDiffView,
} from "@/components/editor/MonacoReadOnlyViews";
import { FileIcon } from "@/components/FileIcon";
import type { ChatMessage } from "@/lib/chat/types";
import type {
  ChatToolDisplay,
  ChatToolDisplayDiff,
  ChatToolDisplayFileList,
  DiffHunk,
  JsonObject,
} from "@/lib/chat/tools/tool-types";
import {
  ChevronUp,
  FileText,
  Globe,
  ListChecks,
  Loader2,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  FilePlus,
  Bot,
} from "lucide-react";

/* ── Utility helpers ── */

function shortenPath(path: string): string {
  if (!path) return "";
  const parts = path.split("/");
  if (parts.length <= 3) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

function extractFileNameFromPathLike(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /^[a-z]+:\/\//i.test(trimmed)) return null;

  const normalized = trimmed.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop() || normalized;
  if (!fileName) return null;

  if (
    normalized.includes("/") ||
    normalized.includes("\\") ||
    /\.[a-z0-9_-]+$/i.test(fileName) ||
    fileName === "Settings"
  ) {
    return fileName;
  }
  return null;
}

function getIOCardFileName(
  display: Extract<ChatToolDisplay, { kind: "input_output" }>,
): string | null {
  try {
    const parsed = JSON.parse(display.input) as Record<string, unknown>;
    const pathValue =
      (typeof parsed.file_path === "string" && parsed.file_path) ||
      (typeof parsed.notebook_path === "string" && parsed.notebook_path) ||
      undefined;
    const fromInput = extractFileNameFromPathLike(pathValue);
    if (fromInput) return fromInput;
  } catch {
    /* fallback */
  }
  return (
    extractFileNameFromPathLike(display.title) ??
    extractFileNameFromPathLike(display.subtitle)
  );
}

function getIOCardFilePath(
  display: Extract<ChatToolDisplay, { kind: "input_output" }>,
): string | undefined {
  try {
    const parsed = JSON.parse(display.input) as Record<string, unknown>;
    const pathValue =
      (typeof parsed.file_path === "string" && parsed.file_path) ||
      (typeof parsed.notebook_path === "string" && parsed.notebook_path) ||
      undefined;
    if (pathValue) return pathValue;
  } catch {
    /* fallback */
  }
  const titlePath =
    typeof display.title === "string" ? display.title : undefined;
  if (titlePath?.includes("/") || titlePath?.includes("\\")) return titlePath;
  return undefined;
}

function getFileNameFromToolInput(input: JsonObject): string | null {
  const pathValue =
    (typeof input.file_path === "string" && input.file_path) ||
    (typeof input.notebook_path === "string" && input.notebook_path) ||
    undefined;
  return extractFileNameFromPathLike(pathValue);
}

function getFilePathFromToolInput(input: JsonObject): string | undefined {
  return (
    (typeof input.file_path === "string" && input.file_path) ||
    (typeof input.notebook_path === "string" && input.notebook_path) ||
    undefined
  );
}

function getReadNavigationLineFromToolInput(input: JsonObject): number {
  const offsetValue = input.offset;
  return typeof offsetValue === "number" && offsetValue > 0 ? offsetValue : 1;
}

function getDiffNavigationLine(display: ChatToolDisplayDiff) {
  const firstHunk = display.hunks[0];
  if (!firstHunk) return 1;
  return Math.max(1, firstHunk.newStart || firstHunk.oldStart || 1);
}

/* ── Timeline icon mapping ── */

function getToolIcon(toolName: string): React.ReactNode {
  const cls = "size-4";
  switch (toolName) {
    case "Read":
      return <FileText className={cls} />;
    case "Write":
    case "Edit":
      return <Pencil className={cls} />;
    case "Bash":
    case "Shell":
      return <SquareTerminal className={cls} />;
    case "Grep":
    case "Glob":
    case "WebSearch":
      return <Search className={cls} />;
    case "WebFetch":
      return <Globe className={cls} />;
    case "TodoWrite":
      return <ListChecks className={cls} />;
    case "NotebookEdit":
      return <FilePlus className={cls} />;
    default:
      return <FileText className={cls} />;
  }
}

/* ── Timeline primitives ── */

function TimelineRow({
  icon,
  label,
  isLast = false,
  children,
  onOpenFileAtLine,
  filePath,
  fileLine,
  previewStateKey,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  isLast?: boolean;
  children?: React.ReactNode;
  onOpenFileAtLine?: (path: string, line: number) => void | Promise<void>;
  filePath?: string;
  fileLine?: number;
  previewStateKey?: string;
}) {
  return (
    <div className="relative flex gap-3 pb-0.5">
      {!isLast && (
        <div className="absolute left-[9px] top-[24px] bottom-0 w-px bg-border-500" />
      )}

      <div className="relative z-[1] flex size-[20px] shrink-0 items-center justify-center text-foreground/55">
        {icon}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-3">
        <div className="flex min-h-[20px] items-center gap-2">
          <span className="text-[12.5px] text-foreground/80">{label}</span>
          {filePath && onOpenFileAtLine && (
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1 text-[12px] text-foreground/60 transition-colors hover:text-foreground"
              onClick={() => void onOpenFileAtLine(filePath, fileLine ?? 1)}
              title={`Open ${filePath}`}
            >
              <FileIcon fileName={filePath.split("/").pop() || filePath} />
              <span className="min-w-0 truncate">
                {filePath.split("/").pop() || filePath}
              </span>
            </button>
          )}
          <PreviewToggle stateKey={previewStateKey} />
        </div>
        {children}
      </div>
    </div>
  );
}

function ThinkingDot() {
  return (
    <div className="relative z-[1] flex size-[20px] shrink-0 items-center justify-center">
      <span className="thinking-glow-dot block size-2 rounded-full bg-sky" />
    </div>
  );
}

function SpinnerIcon() {
  return <Loader2 className="size-4 animate-spin" />;
}

/* ── Preview box ── */

type PreviewViewState = "collapsed" | "peek" | "expanded";

const previewStore = new Map<string, PreviewViewState>();
const previewSubs = new Map<string, Set<() => void>>();

function getPreviewState(key: string, fallback: PreviewViewState) {
  return previewStore.get(key) ?? fallback;
}

function setPreviewState(key: string, state: PreviewViewState) {
  previewStore.set(key, state);
  const subs = previewSubs.get(key);
  if (subs) for (const fn of subs) fn();
}

function usePreviewStore(
  stateKey: string | undefined,
  initialState: PreviewViewState,
) {
  const [, tick] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    if (!stateKey) return;
    if (!previewStore.has(stateKey)) previewStore.set(stateKey, initialState);
    let subs = previewSubs.get(stateKey);
    if (!subs) {
      subs = new Set();
      previewSubs.set(stateKey, subs);
    }
    subs.add(tick);
    return () => {
      subs!.delete(tick);
      if (subs!.size === 0) previewSubs.delete(stateKey);
    };
  }, [stateKey, initialState]);

  const current = stateKey
    ? getPreviewState(stateKey, initialState)
    : initialState;

  const cycle = React.useCallback(
    (baseInit: PreviewViewState) => {
      if (!stateKey) return;
      const s = getPreviewState(stateKey, baseInit);
      let next: PreviewViewState;
      if (s === "collapsed") next = "expanded";
      else if (s === "expanded")
        next = baseInit === "peek" ? "peek" : "collapsed";
      else next = "expanded";
      setPreviewState(stateKey, next);
    },
    [stateKey],
  );

  const toggle = React.useCallback(() => {
    if (!stateKey) return;
    const s = getPreviewState(stateKey, initialState);
    setPreviewState(stateKey, s === "collapsed" ? "expanded" : "collapsed");
  }, [stateKey, initialState]);

  return { current, cycle, toggle };
}

function PreviewBox({
  children,
  stateKey,
  initialState = "collapsed",
  hasExternalToggle = false,
  peekMaxHeight = 140,
  expandedMaxHeight = 400,
  scrollToBottom = false,
}: {
  children: (maxHeight: number) => React.ReactNode;
  stateKey?: string;
  initialState?: PreviewViewState;
  hasExternalToggle?: boolean;
  peekMaxHeight?: number;
  expandedMaxHeight?: number;
  scrollToBottom?: boolean;
}) {
  const { current, cycle } = usePreviewStore(stateKey, initialState);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const isCollapsed = current === "collapsed";
  const isExpanded = current === "expanded";
  const maxHeight = isExpanded
    ? expandedMaxHeight
    : current === "peek"
      ? peekMaxHeight
      : 0;

  React.useEffect(() => {
    if (scrollToBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  if (isCollapsed) return null;

  return (
    <div className="relative overflow-hidden rounded-lg border border-border-500/60 bg-panel-700 shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
      {scrollToBottom && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-6 bg-gradient-to-b from-panel-700 to-transparent" />
      )}

      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
        {children(maxHeight)}
      </div>

      {!hasExternalToggle && (
        <button
          type="button"
          className="absolute right-1.5 top-1.5 z-[3] flex size-5 items-center justify-center rounded bg-panel-500/80 text-foreground/40 transition-colors hover:bg-panel-400 hover:text-foreground/70"
          onClick={() => cycle(initialState)}
          aria-label={isExpanded ? "Collapse preview" : "Expand preview"}
        >
          <ChevronUp
            className={`size-3 transition-transform ${isExpanded ? "" : "rotate-180"}`}
          />
        </button>
      )}

      {!isExpanded && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-panel-700 to-transparent" />
      )}
    </div>
  );
}

function PreviewToggle({ stateKey }: { stateKey?: string }) {
  const { current, toggle } = usePreviewStore(stateKey, "collapsed");
  if (!stateKey) return null;

  const isOpen = current !== "collapsed";

  return (
    <button
      type="button"
      className="inline-flex items-center justify-center text-foreground/30 transition-colors hover:text-foreground/60"
      onClick={toggle}
    >
      <ChevronUp
        className={`size-3 transition-transform ${isOpen ? "" : "rotate-180"}`}
      />
    </button>
  );
}

/* ── Terminal preview ── */

function TerminalPreview({
  command,
  stdout,
  isExpanded,
}: {
  command: string;
  stdout?: string;
  isExpanded: boolean;
}) {
  return (
    <div>
      <div className="px-3 py-2 bg-panel-700">
        <div className="font-mono text-[11px] leading-relaxed text-foreground/70">
          <span className="text-placeholder select-none">$ </span>
          {command}
        </div>
      </div>
      {stdout && (
        <div className="border-t border-border-500/40">
          <MonacoCodeView
            value={stdout}
            language="shell"
            maxHeight={isExpanded ? 340 : 96}
          />
        </div>
      )}
    </div>
  );
}

/* ── Diff stats pill ── */

function DiffStatsPill({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (!additions && !deletions) return null;
  return (
    <span className="inline-flex gap-1.5 text-[11px] font-medium tabular-nums">
      {additions > 0 && <span className="text-green-400">+{additions}</span>}
      {deletions > 0 && <span className="text-red-400">-{deletions}</span>}
    </span>
  );
}

/* ── Todo list inline ── */

const TODO_STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◑",
  completed: "●",
  cancelled: "✕",
};

function TodoListInline({
  display,
}: {
  display: Extract<ChatToolDisplay, { kind: "todo_list" }>;
}) {
  return (
    <div className="space-y-0.5">
      {display.items.map((item) => (
        <div key={item.id} className="flex items-center gap-2 text-[11.5px]">
          <span className="text-placeholder">
            {TODO_STATUS_ICONS[item.status] ?? "○"}
          </span>
          <span
            className={
              item.status === "completed"
                ? "text-placeholder line-through"
                : item.status === "cancelled"
                  ? "text-placeholder"
                  : "text-foreground/80"
            }
          >
            {item.content}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── File list inline ── */

function FileListInline({ display }: { display: ChatToolDisplayFileList }) {
  const items = display.items.map((item) =>
    typeof item === "string" ? { value: item } : item,
  );

  if (items.length === 0) return null;

  return (
    <div className="space-y-0.5 py-1">
      {items.map((item) => (
        <div key={item.value} className="text-[11.5px]">
          <span className="font-mono text-foreground/70 break-all">
            {item.title ?? shortenPath(item.value)}
          </span>
          {item.description && (
            <span className="ml-2 text-[10px] text-placeholder">
              {item.description}
            </span>
          )}
        </div>
      ))}
      {display.truncated && (
        <div className="text-[10px] text-placeholder">Results truncated</div>
      )}
    </div>
  );
}

/* ── Status label helpers ── */

interface ToolAction {
  icon: React.ReactNode;
  label: React.ReactNode;
  preview?: React.ReactNode;
  previewStateKey?: string;
  filePath?: string;
  fileLine?: number;
}

function buildToolAction(
  toolName: string,
  input: JsonObject,
  result:
    | {
        display?: ChatToolDisplay;
        isError?: boolean;
        outputText: string;
      }
    | undefined,
  stateKey: string | undefined,
): ToolAction {
  const display = result?.display;
  const isRunning = !result;
  const isError = result?.isError;

  switch (toolName) {
    case "Read": {
      const fileName =
        display?.kind === "input_output"
          ? getIOCardFileName(display)
          : getFileNameFromToolInput(input);
      const filePath =
        display?.kind === "input_output"
          ? getIOCardFilePath(display)
          : getFilePathFromToolInput(input);
      const line = getReadNavigationLineFromToolInput(input);

      const readLabel = isRunning ? (
        <span className="tool-title-shimmer">
          Reading {fileName ? "" : "file"}
        </span>
      ) : isError ? (
        <span className="text-red-400/90">Unable to read file</span>
      ) : (
        <span>Read</span>
      );

      const fileRef = fileName ? (
        <span className="inline-flex items-center gap-1">
          <FileIcon fileName={fileName} />
          <span className="text-foreground/60">{fileName}</span>
        </span>
      ) : null;

      const label = (
        <span className="inline-flex items-center gap-1.5">
          {readLabel}
          {fileRef}
        </span>
      );

      let preview: React.ReactNode = null;
      if (display?.kind === "input_output" && display.output && !isRunning) {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="collapsed"
            hasExternalToggle
            peekMaxHeight={120}
          >
            {(maxH) => (
              <MonacoCodeView
                value={display.output!}
                filePath={filePath}
                maxHeight={maxH}
              />
            )}
          </PreviewBox>
        );
      }

      return {
        icon: isRunning ? <SpinnerIcon /> : getToolIcon("Read"),
        label,
        preview,
        previewStateKey: preview ? stateKey : undefined,
        filePath: filePath,
        fileLine: line,
      };
    }

    case "Edit":
    case "Write": {
      const fileName = getFileNameFromToolInput(input);
      const filePath = getFilePathFromToolInput(input);

      if (display?.kind === "diff") {
        const diff = display;
        const diffFileName = diff.filePath.split("/").pop() || diff.filePath;
        const actionVerb =
          diff.action === "created"
            ? isRunning
              ? "Creating"
              : "Created"
            : isRunning
              ? "Editing"
              : "Edited";

        const label = (
          <span className="inline-flex items-center gap-1.5">
            <span className={isRunning ? "tool-title-shimmer" : ""}>
              {actionVerb}
            </span>
            <span className="inline-flex items-center gap-1">
              <FileIcon fileName={diffFileName} />
              <span className="text-foreground/60">{diffFileName}</span>
            </span>
            <DiffStatsPill
              additions={diff.additions}
              deletions={diff.deletions}
            />
          </span>
        );

        const hasMonacoDiff =
          diff.action === "created"
            ? Boolean(diff.modifiedContent)
            : diff.originalContent !== undefined &&
              diff.modifiedContent !== undefined;

        let preview: React.ReactNode = null;
        if (diff.hunks.length > 0 && hasMonacoDiff) {
          preview = (
            <PreviewBox stateKey={stateKey} initialState="peek">
              {(maxH) => (
                <MonacoDiffView
                  originalValue={diff.originalContent ?? ""}
                  modifiedValue={diff.modifiedContent ?? ""}
                  filePath={diff.filePath}
                  maxHeight={maxH}
                />
              )}
            </PreviewBox>
          );
        } else if (diff.hunks.length > 0) {
          preview = (
            <PreviewBox stateKey={stateKey} initialState="peek">
              {() => (
                <div className="font-mono text-[11px] leading-[18px]">
                  {diff.hunks.map((hunk, i) => (
                    <DiffHunkView key={`hunk-${i}`} hunk={hunk} />
                  ))}
                </div>
              )}
            </PreviewBox>
          );
        } else if (diff.action === "created" && diff.modifiedContent) {
          preview = (
            <PreviewBox stateKey={stateKey} initialState="peek">
              {(maxH) => (
                <MonacoCodeView
                  value={diff.modifiedContent!}
                  filePath={diff.filePath}
                  maxHeight={maxH}
                />
              )}
            </PreviewBox>
          );
        }

        return {
          icon: isRunning ? (
            <SpinnerIcon />
          ) : diff.action === "created" ? (
            <FilePlus className="size-4" />
          ) : (
            getToolIcon(toolName)
          ),
          label,
          preview,
          filePath: diff.filePath,
          fileLine: getDiffNavigationLine(diff),
        };
      }

      const editLabel = isRunning ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="tool-title-shimmer">
            {toolName === "Write" ? "Writing" : "Editing"}
          </span>
          {fileName && (
            <span className="inline-flex items-center gap-1">
              <FileIcon fileName={fileName} />
              <span className="text-foreground/60">{fileName}</span>
            </span>
          )}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span>{toolName === "Write" ? "Wrote" : "Edited"}</span>
          {fileName && (
            <span className="inline-flex items-center gap-1">
              <FileIcon fileName={fileName} />
              <span className="text-foreground/60">{fileName}</span>
            </span>
          )}
        </span>
      );

      return {
        icon: isRunning ? <SpinnerIcon /> : getToolIcon(toolName),
        label: editLabel,
        filePath,
      };
    }

    case "Bash":
    case "Shell": {
      const cmdDisplay = display?.kind === "command" ? display : undefined;
      const command = cmdDisplay?.command || (input.command as string) || "";
      const description = (input.description as string) || "";
      const cmdIsRunning = isRunning || cmdDisplay?.status === "running";
      const exitCode = cmdDisplay?.exitCode;
      const hasError = exitCode != null && exitCode !== 0;
      const hasOutput = Boolean(cmdDisplay?.stdout || cmdDisplay?.stderr);

      const shellLabel = cmdIsRunning ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="tool-title-shimmer">
            {description ? `Running \`${description}\`` : "Running command"}
          </span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span>{description ? `Ran \`${description}\`` : "Ran command"}</span>
          {hasError && (
            <span className="text-[10px] text-red-400">exit {exitCode}</span>
          )}
        </span>
      );

      let preview: React.ReactNode = null;
      if (command || hasOutput) {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState={cmdIsRunning ? "peek" : "collapsed"}
            hasExternalToggle={!cmdIsRunning}
            scrollToBottom={cmdIsRunning}
            peekMaxHeight={140}
          >
            {(maxH) => (
              <TerminalPreview
                command={command}
                stdout={cmdDisplay?.stdout}
                isExpanded={maxH > 140}
              />
            )}
          </PreviewBox>
        );
      }

      return {
        icon: cmdIsRunning ? <SpinnerIcon /> : getToolIcon("Shell"),
        label: shellLabel,
        preview,
        previewStateKey: preview ? stateKey : undefined,
      };
    }

    case "Grep":
    case "Glob": {
      const pattern = (input.pattern as string) || "";
      const searchLabel = isRunning ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="tool-title-shimmer">Searching</span>
          {pattern && (
            <span className="text-foreground/50 font-mono text-[11px]">
              {pattern}
            </span>
          )}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span>Searched</span>
          {pattern && (
            <span className="text-foreground/50 font-mono text-[11px]">
              {pattern}
            </span>
          )}
        </span>
      );

      let preview: React.ReactNode = null;
      if (display?.kind === "file_list") {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="collapsed"
            hasExternalToggle
            peekMaxHeight={120}
          >
            {() => <FileListInline display={display} />}
          </PreviewBox>
        );
      } else if (display?.kind === "input_output" && display.output) {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="collapsed"
            hasExternalToggle
            peekMaxHeight={120}
          >
            {(maxH) => (
              <MonacoCodeView
                value={display.output!}
                language="plaintext"
                maxHeight={maxH}
              />
            )}
          </PreviewBox>
        );
      }

      return {
        icon: isRunning ? <SpinnerIcon /> : getToolIcon("Grep"),
        label: searchLabel,
        preview,
        previewStateKey: preview ? stateKey : undefined,
      };
    }

    case "WebSearch": {
      const query = (input.query as string) || "";
      const webLabel = isRunning ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="tool-title-shimmer">Searching</span>
          {query && (
            <span className="text-foreground/50 text-[11px]">{query}</span>
          )}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span>Searched</span>
          {query && (
            <span className="text-foreground/50 text-[11px]">{query}</span>
          )}
        </span>
      );

      let preview: React.ReactNode = null;
      if (display?.kind === "file_list") {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="collapsed"
            hasExternalToggle
            peekMaxHeight={140}
          >
            {() => (
              <div className="px-3 py-2">
                <FileListInline display={display} />
              </div>
            )}
          </PreviewBox>
        );
      }

      return {
        icon: isRunning ? <SpinnerIcon /> : getToolIcon("WebSearch"),
        label: webLabel,
        preview,
        previewStateKey: preview ? stateKey : undefined,
      };
    }

    case "WebFetch": {
      const url = (input.url as string) || "";
      const fetchLabel = isRunning ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="tool-title-shimmer">Fetching</span>
          {url && (
            <span className="text-foreground/50 text-[11px] truncate max-w-[240px]">
              {url}
            </span>
          )}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span>Fetched</span>
          {url && (
            <span className="text-foreground/50 text-[11px] truncate max-w-[240px]">
              {url}
            </span>
          )}
        </span>
      );

      let preview: React.ReactNode = null;
      if (display?.kind === "input_output" && display.output) {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="collapsed"
            hasExternalToggle
            peekMaxHeight={120}
          >
            {(maxH) => (
              <MonacoCodeView value={display.output!} maxHeight={maxH} />
            )}
          </PreviewBox>
        );
      }

      return {
        icon: isRunning ? <SpinnerIcon /> : getToolIcon("WebFetch"),
        label: fetchLabel,
        preview,
        previewStateKey: preview ? stateKey : undefined,
      };
    }

    case "TodoWrite": {
      const todoLabel = isRunning ? (
        <span className="tool-title-shimmer">Updating tasks</span>
      ) : (
        <span>Updated tasks</span>
      );

      let preview: React.ReactNode = null;
      if (display?.kind === "todo_list") {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="collapsed"
            hasExternalToggle
            peekMaxHeight={160}
          >
            {() => (
              <div className="px-3 py-2">
                <TodoListInline display={display} />
              </div>
            )}
          </PreviewBox>
        );
      }

      return {
        icon: isRunning ? <SpinnerIcon /> : getToolIcon("TodoWrite"),
        label: todoLabel,
        preview,
        previewStateKey: preview ? stateKey : undefined,
      };
    }

    default: {
      const summary = summarizeToolInput(toolName, input);
      const defaultLabel = isRunning ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="tool-title-shimmer">{toolName}</span>
          {summary && (
            <span className="text-foreground/50 text-[11px]">{summary}</span>
          )}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span>{toolName}</span>
          {isError && <span className="size-1.5 rounded-full bg-red-400" />}
          {summary && (
            <span className="text-foreground/50 text-[11px]">{summary}</span>
          )}
        </span>
      );

      let preview: React.ReactNode = null;
      if (display?.kind === "input_output" && display.output) {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="collapsed"
            hasExternalToggle
            peekMaxHeight={120}
          >
            {(maxH) => (
              <MonacoCodeView value={display.output!} maxHeight={maxH} />
            )}
          </PreviewBox>
        );
      } else if (display?.kind === "json") {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="collapsed"
            hasExternalToggle
            peekMaxHeight={120}
          >
            {(maxH) => (
              <MonacoCodeView
                value={JSON.stringify(display.value, null, 2)}
                language="json"
                maxHeight={maxH}
              />
            )}
          </PreviewBox>
        );
      } else if (display?.kind === "text") {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="collapsed"
            hasExternalToggle
            peekMaxHeight={120}
          >
            {() => (
              <div className="px-3 py-2 text-[12px] text-foreground/80 whitespace-pre-wrap">
                {display.text}
              </div>
            )}
          </PreviewBox>
        );
      } else if (!display && result?.outputText) {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="collapsed"
            hasExternalToggle
            peekMaxHeight={120}
          >
            {(maxH) => (
              <MonacoCodeView value={result.outputText} maxHeight={maxH} />
            )}
          </PreviewBox>
        );
      }

      return {
        icon: isRunning ? <SpinnerIcon /> : getToolIcon(toolName),
        label: defaultLabel,
        preview,
        previewStateKey: preview ? stateKey : undefined,
      };
    }
  }
}

function summarizeToolInput(
  toolName: string,
  input: JsonObject,
): string | null {
  switch (toolName) {
    case "Bash":
    case "Shell":
      return (input.description as string) || (input.command as string) || null;
    case "Read":
    case "Edit":
    case "Write":
      return shortenPath((input.file_path as string) || "");
    case "Glob":
    case "Grep":
      return (input.pattern as string) || null;
    case "NotebookEdit":
      return shortenPath((input.notebook_path as string) || "");
    case "WebFetch":
      return (input.url as string) || null;
    case "WebSearch":
      return (input.query as string) || null;
    case "TodoWrite":
      return "Update tasks";
    default:
      return null;
  }
}

/* ── Diff hunk view ── */

function DiffHunkView({ hunk }: { hunk: DiffHunk }) {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  return (
    <div>
      <div className="bg-panel-600 px-2 py-0.5 text-placeholder text-[10px]">
        {header}
      </div>
      {hunk.lines.map((line, i) => {
        const prefix = line[0];
        let className = "whitespace-pre px-2";
        if (prefix === "+") {
          className += " bg-green-500/10 text-green-400";
        } else if (prefix === "-") {
          className += " bg-red-500/10 text-red-400";
        } else {
          className += " text-foreground/60";
        }
        return (
          <div key={`${hunk.oldStart}-${i}`} className={className}>
            {line}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main renderer ── */

export function ToolMessageRenderer({
  message,
  onOpenFileAtLine,
  pairedResult,
  isLast = false,
}: {
  message: ChatMessage;
  onOpenFileAtLine?: (path: string, line: number) => void | Promise<void>;
  pairedResult?: ChatMessage;
  isLast?: boolean;
}) {
  if (message.subtype === "tool_use" && message.toolInvocation) {
    const { toolName, input, toolCallId } = message.toolInvocation;
    const result = pairedResult?.toolResult;

    const action = buildToolAction(
      toolName,
      input,
      result
        ? {
            display: result.display,
            isError: result.isError,
            outputText: result.outputText,
          }
        : undefined,
      result?.toolCallId ?? toolCallId,
    );

    return (
      <TimelineRow
        icon={action.icon}
        label={action.label}
        isLast={isLast}
        onOpenFileAtLine={action.filePath ? onOpenFileAtLine : undefined}
        filePath={undefined}
        fileLine={action.fileLine}
        previewStateKey={action.previewStateKey}
      >
        {action.preview}
      </TimelineRow>
    );
  }

  if (message.subtype === "tool_result" && message.toolResult) {
    const { toolName, input, display, outputText, isError, toolCallId } =
      message.toolResult;

    const action = buildToolAction(
      toolName,
      input,
      { display, isError, outputText },
      toolCallId,
    );

    return (
      <TimelineRow
        icon={action.icon}
        label={action.label}
        isLast={isLast}
        onOpenFileAtLine={action.filePath ? onOpenFileAtLine : undefined}
        filePath={undefined}
        fileLine={action.fileLine}
        previewStateKey={action.previewStateKey}
      >
        {action.preview}
      </TimelineRow>
    );
  }

  return null;
}

/* ── Thinking timeline row (exported for ChatPanel) ── */

export function ThinkingTimelineRow({
  isStreaming,
  isLast = false,
  children,
}: {
  isStreaming: boolean;
  isLast?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative flex gap-3 pb-0.5">
      {!isLast && (
        <div className="absolute left-[9px] top-[24px] bottom-0 w-px bg-border-500" />
      )}
      <ThinkingDot />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-3">
        <div className="flex min-h-[20px] items-center">
          <span className="text-[12.5px] text-foreground/60">
            {isStreaming ? (
              <span className="tool-title-shimmer">
                Thinking through the process
              </span>
            ) : (
              "Thought process"
            )}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ── Loading/working timeline row (exported for ChatPanel) ── */

export function WorkingTimelineRow({
  text = "Working...",
  isLast = false,
}: {
  text?: string;
  isLast?: boolean;
}) {
  return (
    <div className="relative flex gap-3 pb-0.5">
      {!isLast && (
        <div className="absolute left-[9px] top-[24px] bottom-0 w-px bg-border-500" />
      )}
      <div className="relative z-[1] flex size-[20px] shrink-0 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-foreground/50" />
      </div>
      <div className="flex min-h-[20px] items-center pb-3">
        <span className="text-[12.5px] tool-title-shimmer">{text}</span>
      </div>
    </div>
  );
}

/* ── Assistant message timeline row (exported for ChatPanel) ── */

export function AssistantTimelineRow({
  isLast = false,
  children,
}: {
  isLast?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative flex gap-3 pb-0.5">
      {!isLast && (
        <div className="absolute left-[9px] top-[24px] bottom-0 w-px bg-border-500" />
      )}
      <div className="relative z-[1] flex size-[20px] shrink-0 items-center justify-center">
        <Bot className="size-4 text-foreground" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col pb-3">{children}</div>
    </div>
  );
}
