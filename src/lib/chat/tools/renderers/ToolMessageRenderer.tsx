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
  expanded,
  className,
}: {
  expanded: boolean;
  className?: string;
}) {
  return (
    <svg
      className={`size-3 text-placeholder transition-transform ${expanded ? "rotate-90" : ""} ${className}`}
      viewBox="0 0 16 16"
      fill="currentColor"
    >
      <path
        d="M6 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
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

/* ── Terminal / Bash card ── */

function TerminalCard({
  input,
  display,
}: {
  toolName: string;
  input: JsonObject;
  display: Extract<ChatToolDisplay, { kind: "command" }> | undefined;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const command = display?.command || (input.command as string) || "";
  const description = (input.description as string) || "";
  const isRunning = display?.status === "running";
  const exitCode = display?.exitCode;
  const isComplete = !isRunning && exitCode != null;
  const hasError = exitCode != null && exitCode !== 0;
  const hasOutput = Boolean(display?.stdout || display?.stderr);

  const headerLabel = isComplete
    ? description
      ? `\`${description}\``
      : `Ran command`
    : description
      ? `Running \`${description}\``
      : "Running command";

  return (
    <ToolCard>
      <ToolCardHeader onClick={() => setExpanded(!expanded)} clickable>
        <SquareTerminal className="size-3 text-foreground/50" />
        <span className="min-w-0 text-[12px] text-foreground truncate">
          {headerLabel.split(/`([^`]+)`/).map((part, i) =>
            i % 2 === 1 ? (
              <span key={i} className="rounded py-0.5 text-[11px]">
                {part}
              </span>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </span>
        {isRunning && (
          <span className="ml-auto size-2 rounded-full bg-sky animate-pulse" />
        )}
        {hasError && (
          <span className="ml-auto text-[10px] text-red-400">
            exit {exitCode}
          </span>
        )}
        <ChevronIcon expanded={expanded} className="ml-auto" />
      </ToolCardHeader>

      {expanded && (
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
              style={{ maxHeight: 300 }}
            >
              {display?.stdout && (
                <CodeBlock maxHeight={220} language="shell">
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

function DiffCard({ display }: { display: ChatToolDisplayDiff }) {
  const [expanded, setExpanded] = React.useState(false);
  const hasHunks = display.hunks.length > 0;
  const hasMonacoDiff =
    display.action === "created"
      ? Boolean(display.modifiedContent)
      : display.originalContent !== undefined &&
        display.modifiedContent !== undefined;
  const fileName = display.filePath.split("/").pop() || display.filePath;
  const dirPath = shortenPath(
    display.filePath.split("/").slice(0, -1).join("/"),
  );

  return (
    <ToolCard>
      <ToolCardHeader
        onClick={() => hasHunks && setExpanded(!expanded)}
        clickable={hasHunks}
      >
        <FileIcon fileName={fileName} />
        <span className="min-w-0 truncate text-[12px] text-foreground">
          {fileName}
        </span>
        <span className="ml-auto flex gap-1.5 text-[11px] font-medium tabular-nums">
          {display.additions > 0 && (
            <span className="text-green-400">+{display.additions}</span>
          )}
          {display.deletions > 0 && (
            <span className="text-red-400">-{display.deletions}</span>
          )}
        </span>
        {hasHunks && <ChevronIcon expanded={expanded} />}
      </ToolCardHeader>
      {expanded &&
        hasHunks &&
        (hasMonacoDiff ? (
          <div className="border-t border-border-500">
            <MonacoDiffView
              originalValue={display.originalContent ?? ""}
              modifiedValue={display.modifiedContent ?? ""}
              filePath={display.filePath}
              maxHeight={400}
            />
          </div>
        ) : (
          <TinyScrollArea
            className="border-t border-border-500"
            contentClassName="divide-y divide-border-500"
            style={{ maxHeight: 400 }}
          >
            {display.hunks.map((hunk, i) => (
              <DiffHunkView key={`hunk-${i}`} hunk={hunk} />
            ))}
          </TinyScrollArea>
        ))}
      {!hasHunks && display.action === "created" && (
        <div className="border-t border-border-500">
          {display.modifiedContent ? (
            <MonacoCodeView
              value={display.modifiedContent}
              filePath={display.filePath}
              maxHeight={320}
            />
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

function IOCard({
  display,
}: {
  display: Extract<ChatToolDisplay, { kind: "input_output" }>;
}) {
  const [expanded, setExpanded] = React.useState(display.isError === true);
  // const title = display.title || toolName;
  const hasOutput = Boolean(display.output);
  const fileName = getIOCardFileName(display);
  const filePath = getIOCardFilePath(display);

  return (
    <ToolCard>
      <ToolCardHeader onClick={() => setExpanded(!expanded)} clickable>
        {fileName ? <FileIcon fileName={fileName} /> : null}
        <span className="min-w-0 truncate text-[12px] -ml-1 text-foreground">
          {fileName}
        </span>
        {display.isError && <StatusDot status={"error"} />}
        <ChevronIcon expanded={expanded} className="ml-auto" />
      </ToolCardHeader>
      {expanded && (
        <div className="border-t border-border-500">
          {hasOutput && (
            <CodeBlock maxHeight={300} filePath={filePath}>
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
}: {
  display: ChatToolDisplayFileList;
  toolName: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const items = normalizeFileListItems(display.items);
  const title = display.title || toolName;

  return (
    <ToolCard>
      <ToolCardHeader onClick={() => setExpanded(!expanded)} clickable>
        <Search className="size-3 text-foreground/50" />
        <span className="min-w-0 truncate text-[12px] text-foreground">
          {title}
        </span>

        <ChevronIcon expanded={expanded} className="ml-auto" />
      </ToolCardHeader>
      {expanded && (
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
}: {
  toolName: string;
  input: JsonObject;
}) {
  const summary = summarizeToolInput(toolName, input);

  return (
    <ToolCard>
      <ToolCardHeader>
        <span className="size-2 rounded-full bg-sky animate-pulse" />
        <span className="text-[12px] font-medium text-foreground">
          {toolName}
        </span>
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
  pairedResult,
}: {
  message: ChatMessage;
  pairedResult?: ChatMessage;
}) {
  // Paired tool_use + tool_result → single card
  if (message.subtype === "tool_use" && message.toolInvocation) {
    const { toolName, input } = message.toolInvocation;
    const result = pairedResult?.toolResult;

    if (!result) {
      return <ToolInvocationCard toolName={toolName} input={input} />;
    }

    const display = result.display;

    if (!display) {
      return (
        <ToolCard>
          <ToolCardHeader>
            <StatusDot status={result.isError ? "error" : "success"} />
            <span className="text-[12px] font-medium text-foreground">
              {toolName}
            </span>
          </ToolCardHeader>
          <div className="border-t border-border-500 px-2.5 py-2">
            <CodeBlock maxHeight={300}>{result.outputText}</CodeBlock>
          </div>
        </ToolCard>
      );
    }

    return (
      <ToolDisplayCard display={display} toolName={toolName} input={input} />
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
            <span className="text-[12px] font-medium text-foreground">
              {toolName}
            </span>
          </ToolCardHeader>
          <div className="border-t border-border-500 px-2.5 py-2">
            <CodeBlock maxHeight={300}>{outputText}</CodeBlock>
          </div>
        </ToolCard>
      );
    }
    return (
      <ToolDisplayCard display={display} toolName={toolName} input={input} />
    );
  }

  return null;
}

function ToolDisplayCard({
  display,
  toolName,
  input,
}: {
  display: ChatToolDisplay;
  toolName: string;
  input: JsonObject;
}) {
  switch (display.kind) {
    case "command":
      return (
        <TerminalCard toolName={toolName} input={input} display={display} />
      );
    case "diff":
      return <DiffCard display={display} />;
    case "input_output":
      return <IOCard display={display} />;
    case "file_list":
      return <ListCard display={display} toolName={toolName} />;
    case "todo_list":
      return <TodoCard display={display} />;
    case "json":
      return (
        <ToolCard>
          <ToolCardHeader>
            <StatusDot status="success" />
            <span className="text-[12px] font-medium text-foreground">
              {toolName}
            </span>
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
            <span className="text-[12px] font-medium text-foreground">
              {toolName}
            </span>
          </ToolCardHeader>
          <div className="border-t border-border-500 px-2.5 py-2 text-[12px] text-foreground whitespace-pre-wrap">
            {display.text}
          </div>
        </ToolCard>
      );
  }
}
