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
import { TinyScrollArea } from "@/ui/lower/TinyScrollArea";
import { Search, SquareTerminal } from "lucide-react";

/* ── Primitives ── */

function CodeBlock({
  children,
  maxHeight,
  filePath,
  language,
}: {
  children: string;
  maxHeight?: number;
  filePath?: string;
  language?: string;
}) {
  return (
    <MonacoCodeView
      value={children}
      filePath={filePath}
      language={language}
      maxHeight={maxHeight}
    />
  );
}

function StatusDot({
  status,
}: {
  status: "success" | "error" | "running" | "neutral";
}) {
  const colors: Record<string, string> = {
    success: "bg-green-400",
    error: "bg-red-400",
    running: "bg-sky animate-pulse",
    neutral: "bg-foreground/30",
  };
  return (
    <span className={`inline-block size-2 rounded-full ${colors[status]}`} />
  );
}

function ChevronIcon({
  state,
  className,
}: {
  state: "collapsed" | "peek" | "expanded";
  className?: string;
}) {
  const rotationClass =
    state === "collapsed"
      ? "-rotate-90"
      : state === "expanded"
        ? "rotate-180"
        : "";

  return (
    <svg
      className={`size-3 text-placeholder transition-transform ${rotationClass} ${className}`}
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M4 6l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Tool input summarization ── */

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
    if (fromInput) {
      return fromInput;
    }
  } catch {
    // Ignore non-JSON tool inputs and fall back to title/subtitle heuristics.
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
    if (pathValue) {
      return pathValue;
    }
  } catch {
    // Ignore non-JSON tool inputs and fall back to display metadata.
  }

  const titlePath =
    typeof display.title === "string" ? display.title : undefined;
  if (titlePath?.includes("/") || titlePath?.includes("\\")) {
    return titlePath;
  }
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

/* ── Card wrapper (Codally-style bordered tool card) ── */

function ToolCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`w-full overflow-hidden rounded-[8px] border border-border-500 bg-panel-500 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function ToolCardHeader({
  children,
  onClick,
  clickable = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  clickable?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 text-[12px] ${clickable ? "cursor-pointer hover:bg-panel-400" : ""}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

function ToolTitle({
  children,
  shimmer = false,
  className,
}: {
  children: React.ReactNode;
  shimmer?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`text-[12px] font-medium ${shimmer ? "tool-title-shimmer" : "text-foreground"} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

type ToolCardViewState = "collapsed" | "peek" | "expanded";

const toolCardViewStateByKey = new Map<string, ToolCardViewState>();

function useToolCardViewState(
  stateKey: string | undefined,
  initialState: ToolCardViewState,
) {
  const persistedState = stateKey
    ? toolCardViewStateByKey.get(stateKey)
    : undefined;
  const [viewState, setViewState] = React.useState<ToolCardViewState>(
    persistedState ?? initialState,
  );

  React.useEffect(() => {
    if (!stateKey) return;
    toolCardViewStateByKey.set(stateKey, viewState);
  }, [stateKey, viewState]);

  return [viewState, setViewState] as const;
}

/* ── Terminal / Bash card ── */

function TerminalCard({
  input,
  display,
  stateKey,
}: {
  toolName: string;
  input: JsonObject;
  display: Extract<ChatToolDisplay, { kind: "command" }> | undefined;
  stateKey?: string;
}) {
  const command = display?.command || (input.command as string) || "";
  const description = (input.description as string) || "";
  const isRunning = display?.status === "running";
  const exitCode = display?.exitCode;
  const isComplete = !isRunning && exitCode != null;
  const hasError = exitCode != null && exitCode !== 0;
  const hasOutput = Boolean(display?.stdout || display?.stderr);
  const hasPreview = Boolean(command || hasOutput || isComplete);
  const [viewState, setViewState] = useToolCardViewState(
    stateKey,
    "collapsed",
  );
  const isExpanded = viewState === "expanded";

  const headerLabel = isComplete
    ? description
      ? `\`${description}\``
      : `Ran command`
    : description
      ? `Running \`${description}\``
      : "Running command";

  const toggleView = React.useCallback(() => {
    if (!hasPreview) return;
    setViewState((current) =>
      current === "expanded" ? "collapsed" : "expanded",
    );
  }, [hasPreview, setViewState]);

  return (
    <ToolCard>
      <ToolCardHeader onClick={toggleView} clickable={hasPreview}>
        <SquareTerminal className="size-3 text-foreground/50" />
        <ToolTitle className="min-w-0 truncate" shimmer={isRunning}>
          {headerLabel.split(/`([^`]+)`/).map((part, i) =>
            i % 2 === 1 ? (
              <span key={i} className="rounded py-0.5 text-[11px]">
                {part}
              </span>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </ToolTitle>
        {isRunning && (
          <span className="ml-auto size-2 rounded-full bg-sky animate-pulse" />
        )}
        {hasError && (
          <span className="ml-auto text-[10px] text-red-400">
            exit {exitCode}
          </span>
        )}
        {hasPreview && <ChevronIcon state={viewState} className="ml-auto" />}
      </ToolCardHeader>

      {viewState !== "collapsed" && (
        <div className="border-t border-border-500 bg-panel-500">
          <div className="px-2.5 py-2 bg-panel-700">
            <div className="font-mono text-[11px] leading-relaxed text-foreground/80">
              <span className="text-placeholder select-none">$ </span>
              {command}
            </div>
          </div>

          {hasOutput && (
            <TinyScrollArea
              className="border-t border-border-500"
              style={{ maxHeight: isExpanded ? 300 : 132 }}
            >
              {display?.stdout && (
                <CodeBlock maxHeight={isExpanded ? 220 : 96} language="shell">
                  {display.stdout}
                </CodeBlock>
              )}
            </TinyScrollArea>
          )}

          {!hasOutput && isComplete && (
            <div className="border-t border-border-500 px-2.5 py-1.5 text-[11px] text-placeholder italic">
              No output
            </div>
          )}
        </div>
      )}
    </ToolCard>
  );
}

/* ── Diff card (Edit / Write) ── */

function DiffHunkView({ hunk }: { hunk: DiffHunk }) {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  return (
    <div className="font-mono text-[11px] leading-[18px]">
      <div className="bg-panel-500 px-2 py-0.5 text-placeholder">{header}</div>
      {hunk.lines.map((line, i) => {
        const prefix = line[0];
        let className = "whitespace-pre px-2";
        if (prefix === "+") {
          className += " bg-green-500/10 text-green-400";
        } else if (prefix === "-") {
          className += " bg-red-500/10 text-red-400";
        } else {
          className += " text-foreground/70";
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

function getDiffNavigationLine(display: ChatToolDisplayDiff) {
  const firstHunk = display.hunks[0];
  if (!firstHunk) {
    return 1;
  }

  return Math.max(1, firstHunk.newStart || firstHunk.oldStart || 1);
}

function DiffCard({
  display,
  onOpenFileAtLine,
  stateKey,
}: {
  display: ChatToolDisplayDiff;
  onOpenFileAtLine?: (path: string, line: number) => void | Promise<void>;
  stateKey?: string;
}) {
  const hasHunks = display.hunks.length > 0;
  const hasMonacoDiff =
    display.action === "created"
      ? Boolean(display.modifiedContent)
      : display.originalContent !== undefined &&
        display.modifiedContent !== undefined;
  const fileName = display.filePath.split("/").pop() || display.filePath;
  const hasPreview = hasHunks || Boolean(display.modifiedContent);
  const [viewState, setViewState] = useToolCardViewState(
    stateKey,
    hasPreview ? "peek" : "collapsed",
  );
  const isExpanded = viewState === "expanded";

  return (
    <ToolCard>
      <ToolCardHeader
        onClick={() =>
          hasPreview &&
          setViewState((current) =>
            current === "expanded" ? "peek" : "expanded",
          )
        }
        clickable={hasPreview}
      >
        <FileIcon fileName={fileName} />
        <button
          type="button"
          className="min-w-0 truncate text-[12px] text-foreground hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            void onOpenFileAtLine?.(
              display.filePath,
              getDiffNavigationLine(display),
            );
          }}
          title={`Open ${display.filePath}`}
        >
          {fileName}
        </button>
        <span className="ml-auto flex gap-1.5 text-[11px] font-medium tabular-nums">
          {display.additions > 0 && (
            <span className="text-green-400">+{display.additions}</span>
          )}
          {display.deletions > 0 && (
            <span className="text-red-400">-{display.deletions}</span>
          )}
        </span>
        {hasPreview && <ChevronIcon state={viewState} />}
      </ToolCardHeader>
      {viewState !== "collapsed" &&
        hasHunks &&
        (hasMonacoDiff ? (
          <div className="border-t border-border-500">
            <MonacoDiffView
              originalValue={display.originalContent ?? ""}
              modifiedValue={display.modifiedContent ?? ""}
              filePath={display.filePath}
              maxHeight={isExpanded ? 400 : 140}
            />
          </div>
        ) : (
          <TinyScrollArea
            className="border-t border-border-500"
            contentClassName="divide-y divide-border-500"
            style={{ maxHeight: isExpanded ? 400 : 140 }}
          >
            {display.hunks.map((hunk, i) => (
              <DiffHunkView key={`hunk-${i}`} hunk={hunk} />
            ))}
          </TinyScrollArea>
        ))}
      {!hasHunks && display.action === "created" && (
        <div className="border-t border-border-500">
          {display.modifiedContent ? (
            viewState !== "collapsed" ? (
              <MonacoCodeView
                value={display.modifiedContent}
                filePath={display.filePath}
                maxHeight={isExpanded ? 320 : 140}
              />
            ) : null
          ) : (
            <div className="px-2.5 py-1 text-[11px] text-placeholder">
              New file created
            </div>
          )}
        </div>
      )}
    </ToolCard>
  );
}

/* ── IO card (Read, Grep, Write fallback, etc.) ── */

function ReadHeader({
  isRunning = false,
}: {
  isRunning?: boolean;
}) {
  return (
    <>
      <ToolTitle shimmer={isRunning} className="shrink-0">
        {isRunning ? "Reading..." : "Read"}
      </ToolTitle>
    </>
  );
}

function ReadFilePill({
  fileName,
  filePath,
  line,
  onOpenFileAtLine,
}: {
  fileName: string | null;
  filePath?: string;
  line: number;
  onOpenFileAtLine?: (path: string, line: number) => void | Promise<void>;
}) {
  if (!fileName) {
    return null;
  }

  const isClickable = Boolean(filePath && onOpenFileAtLine);
  const className = `inline-flex min-w-0 items-center gap-1 rounded-md border border-border-500 px-2 py-1 text-[11px] text-foreground transition-colors ${
    isClickable
      ? "cursor-pointer hover:border-border-400 hover:bg-panel-400"
      : ""
  }`;
  const content = (
    <>
      <FileIcon fileName={fileName} />
      <span className="min-w-0 truncate text-[12px] -ml-1 text-foreground">
        {fileName}
      </span>
    </>
  );

  if (!isClickable || !filePath) {
    return <span className={className}>{content}</span>;
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void onOpenFileAtLine?.(filePath, line);
      }}
      title={`Open ${filePath}`}
    >
      {content}
    </button>
  );
}

function ReadInline({
  display,
  onOpenFileAtLine,
}: {
  display: Extract<ChatToolDisplay, { kind: "input_output" }>;
  onOpenFileAtLine?: (path: string, line: number) => void | Promise<void>;
}) {
  const fileName = getIOCardFileName(display);
  const filePath = getIOCardFilePath(display);
  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      <div className="flex min-w-0 items-center gap-2 text-[12px]">
        <ReadHeader />
        <ReadFilePill
          fileName={fileName}
          filePath={filePath}
          line={1}
          onOpenFileAtLine={onOpenFileAtLine}
        />
      </div>
      {display.isError && <StatusDot status="error" />}
    </div>
  );
}

function IOCard({
  display,
  stateKey,
}: {
  display: Extract<ChatToolDisplay, { kind: "input_output" }>;
  stateKey?: string;
}) {
  const hasOutput = Boolean(display.output);
  const fileName = getIOCardFileName(display);
  const filePath = getIOCardFilePath(display);
  const [viewState, setViewState] = useToolCardViewState(
    stateKey,
    display.isError ? "expanded" : hasOutput ? "peek" : "collapsed",
  );
  const hasPreview = hasOutput;
  const isExpanded = viewState === "expanded";

  return (
    <ToolCard>
      <ToolCardHeader
        onClick={() =>
          hasPreview &&
          setViewState((current) =>
            current === "expanded" ? "peek" : "expanded",
          )
        }
        clickable={hasPreview}
      >
        {fileName ? <FileIcon fileName={fileName} /> : null}
        <span className="min-w-0 truncate text-[12px] -ml-1 text-foreground">
          {fileName}
        </span>
        {display.isError && <StatusDot status={"error"} />}
        {hasPreview && <ChevronIcon state={viewState} className="ml-auto" />}
      </ToolCardHeader>
      {viewState !== "collapsed" && (
        <div className="border-t border-border-500">
          {hasOutput && (
            <CodeBlock maxHeight={isExpanded ? 300 : 132} filePath={filePath}>
              {display.output!}
            </CodeBlock>
          )}
        </div>
      )}
    </ToolCard>
  );
}

/* ── File list / result list card (Glob, WebSearch) ── */

function normalizeFileListItems(items: ChatToolDisplayFileList["items"]) {
  return items.map((item) =>
    typeof item === "string" ? { value: item } : item,
  );
}

function ListCard({
  display,
  toolName,
  stateKey,
}: {
  display: ChatToolDisplayFileList;
  toolName: string;
  stateKey?: string;
}) {
  const items = normalizeFileListItems(display.items);
  const title = display.title || toolName;
  const hasPreview = items.length > 0;
  const [viewState, setViewState] = useToolCardViewState(
    stateKey,
    "collapsed",
  );

  return (
    <ToolCard>
      <ToolCardHeader
        onClick={() =>
          hasPreview &&
          setViewState((current) =>
            current === "expanded" ? "collapsed" : "expanded",
          )
        }
        clickable={hasPreview}
      >
        <Search className="size-3 text-foreground/50" />
        <span className="min-w-0 truncate text-[12px] text-foreground">
          {title}
        </span>

        {hasPreview && <ChevronIcon state={viewState} className="ml-auto" />}
      </ToolCardHeader>
      {viewState !== "collapsed" && (
        <TinyScrollArea
          className="border-t border-border-500"
          style={{ maxHeight: 300 }}
        >
          <div className="divide-y divide-border-500/50">
            {items.map((item) => (
              <div key={item.value} className="px-2.5 py-1.5 text-[11.5px]">
                <div className="text-foreground break-all font-mono">
                  {item.title ?? shortenPath(item.value)}
                </div>
                {item.description && (
                  <div className="mt-0.5 whitespace-pre-wrap break-words text-[10px] text-placeholder">
                    {item.description}
                  </div>
                )}
              </div>
            ))}
          </div>
          {display.truncated && (
            <div className="px-2.5 py-1 text-[10px] text-placeholder">
              Results truncated
            </div>
          )}
        </TinyScrollArea>
      )}
    </ToolCard>
  );
}

/* ── Todo list card ── */

const TODO_STATUS_ICONS: Record<string, string> = {
  pending: "○",
  in_progress: "◑",
  completed: "●",
  cancelled: "✕",
};

function TodoCard({
  display,
}: {
  display: Extract<ChatToolDisplay, { kind: "todo_list" }>;
}) {
  return (
    <ToolCard>
      <ToolCardHeader>
        <span className="text-[12px]">☑️</span>
        <span className="text-[12px] font-medium text-foreground">
          {display.title ?? "Tasks"}
        </span>
      </ToolCardHeader>
      <div className="border-t border-border-500 divide-y divide-border-500">
        {display.items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]"
          >
            <span className="text-placeholder">
              {TODO_STATUS_ICONS[item.status] ?? "○"}
            </span>
            <span
              className={`flex-1 ${item.status === "completed" ? "text-placeholder line-through" : item.status === "cancelled" ? "text-placeholder" : "text-foreground"}`}
            >
              {item.content}
            </span>
          </div>
        ))}
      </div>
    </ToolCard>
  );
}

/* ── Standalone tool_use card (when no paired result yet) ── */

function ToolInvocationCard({
  toolName,
  input,
  onOpenFileAtLine,
}: {
  toolName: string;
  input: JsonObject;
  onOpenFileAtLine?: (path: string, line: number) => void | Promise<void>;
}) {
  if (toolName === "Read") {
    const fileName = getFileNameFromToolInput(input);
    const filePath = getFilePathFromToolInput(input);
    const navigationLine = getReadNavigationLineFromToolInput(input);

    return (
      <div className="flex items-center gap-2 px-1 py-0.5">
        <ToolTitle shimmer className="min-w-0 truncate text-[12px]">
          Reading...
        </ToolTitle>
        <ReadFilePill
          fileName={fileName}
          filePath={filePath}
          line={navigationLine}
          onOpenFileAtLine={onOpenFileAtLine}
        />
        <span className="size-2 rounded-full bg-sky animate-pulse" />
      </div>
    );
  }

  const summary = summarizeToolInput(toolName, input);

  return (
    <ToolCard>
      <ToolCardHeader>
        <span className="size-2 rounded-full bg-sky animate-pulse" />
        <ToolTitle shimmer>{toolName}</ToolTitle>
        {summary && (
          <span className="min-w-0 truncate text-[11px] text-placeholder">
            {summary}
          </span>
        )}
      </ToolCardHeader>
    </ToolCard>
  );
}

/* ── Main renderer ── */

export function ToolMessageRenderer({
  message,
  onOpenFileAtLine,
  pairedResult,
}: {
  message: ChatMessage;
  onOpenFileAtLine?: (path: string, line: number) => void | Promise<void>;
  pairedResult?: ChatMessage;
}) {
  // Paired tool_use + tool_result → single card
  if (message.subtype === "tool_use" && message.toolInvocation) {
    const { toolName, input } = message.toolInvocation;
    const result = pairedResult?.toolResult;

    if (!result) {
      return (
        <ToolInvocationCard
          toolName={toolName}
          input={input}
          onOpenFileAtLine={onOpenFileAtLine}
        />
      );
    }

    const display = result.display;

    if (!display) {
      return (
        <ToolCard>
          <ToolCardHeader>
            <StatusDot status={result.isError ? "error" : "success"} />
            <ToolTitle>{toolName}</ToolTitle>
          </ToolCardHeader>
          <div className="border-t border-border-500 px-2.5 py-2">
            <CodeBlock maxHeight={300}>{result.outputText}</CodeBlock>
          </div>
        </ToolCard>
      );
    }

    return (
      <ToolDisplayCard
        display={display}
        toolName={toolName}
        input={input}
        onOpenFileAtLine={onOpenFileAtLine}
        stateKey={result.toolCallId}
      />
    );
  }

  // Standalone tool_result (no paired tool_use found)
  if (message.subtype === "tool_result" && message.toolResult) {
    const { display, toolName, input, outputText, isError } =
      message.toolResult;
    if (!display) {
      return (
        <ToolCard>
          <ToolCardHeader>
            <StatusDot status={isError ? "error" : "success"} />
            <ToolTitle>{toolName}</ToolTitle>
          </ToolCardHeader>
          <div className="border-t border-border-500 px-2.5 py-2">
            <CodeBlock maxHeight={300}>{outputText}</CodeBlock>
          </div>
        </ToolCard>
      );
    }
    return (
      <ToolDisplayCard
        display={display}
        toolName={toolName}
        input={input}
        onOpenFileAtLine={onOpenFileAtLine}
        stateKey={message.toolResult.toolCallId}
      />
    );
  }

  return null;
}

function ToolDisplayCard({
  display,
  toolName,
  input,
  onOpenFileAtLine,
  stateKey,
}: {
  display: ChatToolDisplay;
  toolName: string;
  input: JsonObject;
  onOpenFileAtLine?: (path: string, line: number) => void | Promise<void>;
  stateKey?: string;
}) {
  switch (display.kind) {
    case "command":
      return (
        <TerminalCard
          toolName={toolName}
          input={input}
          display={display}
          stateKey={stateKey}
        />
      );
    case "diff":
      return (
        <DiffCard
          display={display}
          onOpenFileAtLine={onOpenFileAtLine}
          stateKey={stateKey}
        />
      );
    case "input_output":
      return toolName === "Read" ? (
        <ReadInline display={display} onOpenFileAtLine={onOpenFileAtLine} />
      ) : (
        <IOCard display={display} stateKey={stateKey} />
      );
    case "file_list":
      return (
        <ListCard display={display} toolName={toolName} stateKey={stateKey} />
      );
    case "todo_list":
      return <TodoCard display={display} />;
    case "json":
      return (
        <ToolCard>
          <ToolCardHeader>
            <StatusDot status="success" />
            <ToolTitle>{toolName}</ToolTitle>
          </ToolCardHeader>
          <div className="border-t border-border-500 px-2.5 py-2">
            <CodeBlock maxHeight={300} language="json">
              {JSON.stringify(display.value, null, 2)}
            </CodeBlock>
          </div>
        </ToolCard>
      );
    case "text":
    default:
      return (
        <ToolCard>
          <ToolCardHeader>
            <StatusDot status="success" />
            <ToolTitle>{toolName}</ToolTitle>
          </ToolCardHeader>
          <div className="border-t border-border-500 px-2.5 py-2 text-[12px] text-foreground whitespace-pre-wrap">
            {display.text}
          </div>
        </ToolCard>
      );
  }
}
