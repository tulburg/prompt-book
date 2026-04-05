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
  ChatToolDisplayQuestion,
  ChatToolDisplayTask,
  DiffHunk,
  JsonObject,
} from "@/lib/chat/tools/tool-types";
import {
  ChevronUp,
  Cuboid,
  FileText,
  Globe,
  ListChecks,
  Loader2,
  Pencil,
  Search,
  Shapes,
  Sparkles,
  SquareTerminal,
  FilePlus,
  Bot,
  CircleX,
} from "lucide-react";
import Bus from "@/lib/bus";

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
    case "TaskCreate":
    case "TaskGet":
    case "TaskList":
    case "TaskUpdate":
      return <ListChecks className={cls} />;
    case "AskUserQuestion":
      return <Sparkles className={cls} />;
    case "Context":
      return <Shapes className={cls} />;
    case "Block":
      return <Cuboid className={cls} />;
    case "Agent":
    case "Task":
    case "TaskOutput":
      return <Bot className={cls} />;
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
              className="inline-flex min-w-0 items-center gap-1 text-[12px] text-foreground/60 transition-colors hover:text-foreground border border-border-500 rounded-[6px] pl-1 pr-2 py-0.5 hover:bg-panel-600 cursor-pointer"
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

function summarizeTodoDisplay(
  display: Extract<ChatToolDisplay, { kind: "todo_list" }>,
): string {
  const completed = display.items.filter(
    (item) => item.status === "completed",
  ).length;
  const inProgress = display.items.find(
    (item) => item.status === "in_progress",
  );
  if (inProgress) {
    return `${inProgress.content} (${completed + 1}/${display.items.length})`;
  }
  if (display.items.length > 0 && completed === display.items.length) {
    return `All ${display.items.length} tasks completed`;
  }
  return `${display.items.length} task${display.items.length === 1 ? "" : "s"}`;
}

type QuestionAnswers = Record<string, string | string[]>;

function isQuestionAnswered(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.trim().length > 0;
}

function formatQuestionAnswer(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string") return value.trim();
  return "";
}

function buildQuestionReply(
  display: ChatToolDisplayQuestion,
  answers: QuestionAnswers,
): string {
  const answeredQuestions = display.questions
    .map((question, index) => {
      const answer = formatQuestionAnswer(answers[question.id]);
      if (!answer) return null;
      if (display.questions.length === 1) return answer;
      return `${index + 1}. ${question.prompt}: ${answer}`;
    })
    .filter((value): value is string => Boolean(value));

  return answeredQuestions.join("\n");
}

export function getQuestionToolDisplay(
  message: ChatMessage,
  pairedResult?: ChatMessage,
): ChatToolDisplayQuestion | null {
  if (
    message.subtype === "tool_use" &&
    message.toolInvocation?.toolName === "AskUserQuestion" &&
    pairedResult?.toolResult?.display?.kind === "question"
  ) {
    return pairedResult.toolResult.display;
  }

  if (
    message.subtype === "tool_result" &&
    message.toolResult?.toolName === "AskUserQuestion" &&
    message.toolResult.display?.kind === "question"
  ) {
    return message.toolResult.display;
  }

  return null;
}

export function QuestionSurfaceCard({
  display,
}: {
  display: ChatToolDisplayQuestion;
}) {
  const [answers, setAnswers] = React.useState<QuestionAnswers>({});
  const submitLabel = display.submitLabel?.trim() || "Submit answer";
  const allAnswered =
    display.questions.length > 0 &&
    display.questions.every((question) =>
      isQuestionAnswered(answers[question.id]),
    );

  const handleSubmit = React.useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const text = buildQuestionReply(display, answers);
      if (!text) return;
      Bus.emit("chat:send-message", { text });
    },
    [answers, display],
  );

  return (
    <form
      className="rounded-2xl border border-border-500 bg-panel-600 shadow-[0_8px_28px_rgba(0,0,0,0.16)]"
      onSubmit={handleSubmit}
    >
      <div className="border-b border-border-500 px-4 py-3">
        <div className="flex items-center gap-2 text-[12px] font-medium text-foreground/80">
          <Sparkles className="size-4 text-foreground/55" />
          <span>{display.title?.trim() || "Asked a question"}</span>
        </div>
        {display.description && (
          <div className="mt-1 text-[12px] text-foreground/65">
            {display.description}
          </div>
        )}
      </div>

      <div className="space-y-3 px-4 py-4">
        {display.questions.map((question, index) => {
          const value = answers[question.id];
          const selectedValues = Array.isArray(value) ? value : [];
          const singleValue = typeof value === "string" ? value : "";
          return (
            <div
              key={question.id}
              className="rounded-xl border border-border-600/70 bg-panel-400/60 px-3 py-3"
            >
              <div className="text-[13px] font-medium text-foreground">
                {display.questions.length > 1 ? `${index + 1}. ` : ""}
                {question.prompt}
              </div>
              {question.details && (
                <div className="mt-1 text-[11px] text-foreground/60">
                  {question.details}
                </div>
              )}

              {question.options && question.options.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {question.options.map((option) => {
                    const isSelected =
                      question.responseType === "multi_select"
                        ? selectedValues.includes(option.label)
                        : singleValue === option.label;
                    return (
                      <button
                        type="button"
                        key={option.id}
                        className={`cursor-pointer rounded-lg border px-3 py-1.5 text-left text-[12px] transition-colors ${
                          isSelected
                            ? "border-sky/70 bg-sky/15 text-foreground"
                            : "border-border-500/60 bg-panel-700 text-foreground/80 hover:border-foreground/25 hover:bg-panel-600"
                        }`}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setAnswers((current) => {
                            const next = { ...current };
                            if (question.responseType === "multi_select") {
                              const existing = Array.isArray(next[question.id])
                                ? (next[question.id] as string[])
                                : [];
                              next[question.id] = existing.includes(
                                option.label,
                              )
                                ? existing.filter(
                                    (item) => item !== option.label,
                                  )
                                : [...existing, option.label];
                            } else {
                              next[question.id] = option.label;
                            }
                            return next;
                          });
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <textarea
                  className="mt-3 min-h-[88px] w-full resize-y rounded-xl border border-border-500/70 bg-panel-700 px-3 py-2 text-[12px] text-foreground outline-none transition-colors placeholder:text-placeholder focus:border-sky/60"
                  value={singleValue}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value,
                    }))
                  }
                  placeholder="Type your answer"
                />
              )}
            </div>
          );
        })}

        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-placeholder">
            {display.helpText || "Submit to continue the conversation."}
          </div>
          <button
            type="submit"
            className="cursor-pointer rounded-lg bg-sky px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!allAnswered}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

function QuestionPreview({ display }: { display: ChatToolDisplayQuestion }) {
  return (
    <div className="space-y-3 px-3 py-2">
      {display.description && (
        <div className="text-[12px] text-foreground/75">
          {display.description}
        </div>
      )}
      {display.questions.map((question, index) => (
        <div
          key={question.id}
          className="rounded-lg border border-border-500/60 bg-panel-600/60 px-3 py-2"
        >
          <div className="text-[12px] font-medium text-foreground">
            {display.questions.length > 1 ? `${index + 1}. ` : ""}
            {question.prompt}
          </div>
          {question.details && (
            <div className="mt-1 text-[11px] text-foreground/60">
              {question.details}
            </div>
          )}
          {question.options && question.options.length > 0 ? (
            <div className="mt-2 space-y-1">
              {question.options.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  className="w-full cursor-pointer rounded border border-border-500/50 bg-panel-700 px-2 py-1 text-left text-[11px] text-foreground/80 transition-colors hover:border-foreground/30 hover:bg-panel-600"
                  onClick={() =>
                    Bus.emit("chat:send-message", { text: option.label })
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-placeholder">
              {question.responseType === "multi_select"
                ? "Answer with multiple selections in your next message."
                : "Answer in your next message."}
            </div>
          )}
        </div>
      ))}
      {display.helpText && (
        <div className="text-[11px] text-placeholder">{display.helpText}</div>
      )}
    </div>
  );
}

function TaskStatusPill({ status }: { status: ChatToolDisplayTask["status"] }) {
  const className =
    status === "completed"
      ? "text-green-400 bg-green-500/10"
      : status === "running" || status === "pending"
        ? "text-sky bg-sky/10"
        : "text-amber-300 bg-amber-500/10";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] ${className}`}
    >
      {status}
    </span>
  );
}

function TaskPreview({ display }: { display: ChatToolDisplayTask }) {
  return (
    <div className="space-y-3 px-3 py-2">
      <div className="flex items-center gap-2">
        <TaskStatusPill status={display.status} />
        {display.agentName && (
          <span className="text-[11px] text-foreground/60">
            {display.agentName}
          </span>
        )}
      </div>
      <div className="text-[12px] text-foreground">{display.summary}</div>
      {display.metadata && display.metadata.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {display.metadata.map((item) => (
            <span
              key={`${item.label}:${item.value}`}
              className="rounded border border-border-500/60 px-2 py-1 text-[10px] text-foreground/65"
            >
              {item.label}: {item.value}
            </span>
          ))}
        </div>
      )}
      {display.prompt && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-placeholder">
            Prompt
          </div>
          <div className="whitespace-pre-wrap rounded border border-border-500/60 bg-panel-700 px-2 py-2 text-[11px] text-foreground/80">
            {display.prompt}
          </div>
        </div>
      )}
      {display.result && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-placeholder">
            Result
          </div>
          <div className="whitespace-pre-wrap rounded border border-border-500/60 bg-panel-700 px-2 py-2 text-[11px] text-foreground/75">
            {display.result}
          </div>
        </div>
      )}
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

function getBlockActionSummary(input: JsonObject): string | null {
  const action = typeof input.action === "string" ? input.action : "";
  const blockId = typeof input.block_id === "string" ? input.block_id : "";
  if (!action) {
    return blockId || null;
  }

  switch (action) {
    case "list":
      return "List Blocks";
    case "read":
      return blockId ? `Read Block: ${blockId}` : "Read Block";
    case "read_context":
      return blockId ? `Read Block Context: ${blockId}` : "Read Block Context";
    case "read_diagram":
      return blockId ? `Read Block Diagram: ${blockId}` : "Read Block Diagram";
    case "read_files":
      return blockId ? `Read Block Files: ${blockId}` : "Read Block Files";
    case "write":
      return blockId ? `Write Block: ${blockId}` : "Write Block";
    default:
      return blockId ? `Block: ${blockId}` : "Block";
  }
}

function getToolWriteResultAction(
  result:
    | {
        display?: ChatToolDisplay;
        isError?: boolean;
        outputText: string;
      }
    | undefined,
): "created" | "updated" | null {
  if (!result || result.isError) {
    return null;
  }
  if (result.display?.kind === "json") {
    const value = result.display.value;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "action" in value &&
      (value.action === "created" || value.action === "updated")
    ) {
      return value.action;
    }
  }
  if (result.display?.kind === "input_output") {
    const subtitle = result.display.subtitle?.toLowerCase() ?? "";
    if (subtitle.startsWith("created")) {
      return "created";
    }
    if (subtitle.startsWith("updated")) {
      return "updated";
    }
  }
  if (/^created\b/i.test(result.outputText)) {
    return "created";
  }
  if (/^updated\b/i.test(result.outputText)) {
    return "updated";
  }
  return null;
}

function getContextActionSummary(
  input: JsonObject,
  resultAction: "created" | "updated" | null = null,
): string | null {
  const action = typeof input.action === "string" ? input.action : "";
  const filename = typeof input.filename === "string" ? input.filename : "";
  if (!action) {
    return filename || null;
  }

  switch (action) {
    case "list":
      return "List Contexts";
    case "read":
      return filename ? `Read Context: ${filename}` : "Read Context";
    case "write":
      if (resultAction === "created") {
        return filename ? `Create Context: ${filename}` : "Create Context";
      }
      if (resultAction === "updated") {
        return filename ? `Update Context: ${filename}` : "Update Context";
      }
      return filename ? `Write Context: ${filename}` : "Write Context";
    default:
      return filename ? `Context: ${filename}` : "Context";
  }
}

function buildToolAction(
  toolName: string,
  input: JsonObject,
  canOpenFile: boolean,
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
    case "Context": {
      const summary =
        getContextActionSummary(input, getToolWriteResultAction(result)) ??
        "Context";
      const label = isRunning ? (
        <span className="tool-title-shimmer">{summary}</span>
      ) : (
        <span>{summary}</span>
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
        icon: isRunning ? <SpinnerIcon /> : getToolIcon("Context"),
        label,
        preview,
        previewStateKey: preview ? stateKey : undefined,
      };
    }

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
      const showInlineFileName = !filePath || !canOpenFile;

      const readLabel = isRunning ? (
        <span className="tool-title-shimmer">
          Reading {fileName ? "" : "file"}
        </span>
      ) : isError ? (
        <span className="text-red-400/90">Unable to read file</span>
      ) : (
        <span>Read</span>
      );

      const fileRef =
        fileName && showInlineFileName ? (
          <span className="inline-flex items-center gap-1 rounded border border-red-500 px-1.5 py-0.5">
            <FileIcon fileName={fileName} />{" "}
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
      const showInlineFileName = !filePath || !canOpenFile;
      const inlineFileRef = fileName && showInlineFileName && (
        <span className="inline-flex items-center gap-1">
          <FileIcon fileName={fileName} />
          <span className="text-foreground/60">{fileName}</span>
        </span>
      );

      if (display?.kind === "diff") {
        const diff = display;
        const diffFileName = diff.filePath.split("/").pop() || diff.filePath;
        const showInlineDiffFileName = !canOpenFile;
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
            {showInlineDiffFileName && (
              <span className="inline-flex items-center gap-1">
                <FileIcon fileName={diffFileName} />
                <span className="text-foreground/60">{diffFileName}</span>
              </span>
            )}
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
          {inlineFileRef}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span>{toolName === "Write" ? "Wrote" : "Edited"}</span>
          {inlineFileRef}
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
      if (display?.kind === "question") {
        const label = isRunning ? (
          <span className="tool-title-shimmer">Checking command permissions</span>
        ) : (
          <span>Awaiting bash approval</span>
        );
        const preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="expanded"
            hasExternalToggle
            peekMaxHeight={220}
            expandedMaxHeight={420}
          >
            {() => <QuestionPreview display={display} />}
          </PreviewBox>
        );
        return {
          icon: isRunning ? <SpinnerIcon /> : getToolIcon("Shell"),
          label,
          preview,
          previewStateKey: stateKey,
        };
      }

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
        <span className="inline-flex items-center gap-1.5 wrap flex-wrap">
          <span>Searched</span>
          {pattern && (
            <span className="text-foreground/50 font-mono text-[11px] flex flex-wrap max-w-[100%] break-all">
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

    case "TodoWrite":
    case "TaskCreate":
    case "TaskGet":
    case "TaskList":
    case "TaskUpdate": {
      const listDisplay = display?.kind === "todo_list" ? display : undefined;
      const taskSummary = listDisplay
        ? summarizeTodoDisplay(listDisplay)
        : "Tasks";
      const todoLabel = isRunning ? (
        <span className="tool-title-shimmer">Updating tasks</span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span>
            {toolName === "TaskList" || toolName === "TaskGet"
              ? "Viewed tasks"
              : "Updated tasks"}
          </span>
          {listDisplay && (
            <span className="text-[11px] text-foreground/50">
              {taskSummary}
            </span>
          )}
        </span>
      );

      let preview: React.ReactNode = null;
      if (listDisplay) {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState={toolName === "TaskList" ? "peek" : "collapsed"}
            hasExternalToggle
            peekMaxHeight={160}
          >
            {() => (
              <div className="px-3 py-2">
                <TodoListInline display={listDisplay} />
              </div>
            )}
          </PreviewBox>
        );
      }

      return {
        icon: isRunning ? <SpinnerIcon /> : getToolIcon(toolName),
        label: todoLabel,
        preview,
        previewStateKey: preview ? stateKey : undefined,
      };
    }

    case "AskUserQuestion": {
      const questionDisplay =
        display?.kind === "question" ? display : undefined;
      const questionCount = questionDisplay?.questions.length ?? 0;
      const label = isRunning ? (
        <span className="tool-title-shimmer">Preparing question</span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <span>Asked a question</span>
          {questionCount > 0 && (
            <span className="text-[11px] text-foreground/50">
              {questionCount} item{questionCount === 1 ? "" : "s"}
            </span>
          )}
        </span>
      );

      const preview = questionDisplay ? (
        <PreviewBox
          stateKey={stateKey}
          initialState="expanded"
          hasExternalToggle
          peekMaxHeight={220}
          expandedMaxHeight={420}
        >
          {() => <QuestionPreview display={questionDisplay} />}
        </PreviewBox>
      ) : null;

      return {
        icon: isRunning ? <SpinnerIcon /> : getToolIcon("AskUserQuestion"),
        label,
        preview,
        previewStateKey: preview ? stateKey : undefined,
      };
    }

    case "Block": {
      const resultAction = getToolWriteResultAction(result);
      const summary =
        typeof input.action === "string" && input.action === "write"
          ? (() => {
              const blockId =
                typeof input.block_id === "string" ? input.block_id : "";
              if (resultAction === "created") {
                return blockId ? `Create Block: ${blockId}` : "Create Block";
              }
              if (resultAction === "updated") {
                return blockId ? `Update Block: ${blockId}` : "Update Block";
              }
              return getBlockActionSummary(input) ?? "Block";
            })()
          : (getBlockActionSummary(input) ?? "Block");
      const label = isRunning ? (
        <span className="tool-title-shimmer">{summary}</span>
      ) : (
        <span>{summary}</span>
      );

      let preview: React.ReactNode = null;
      if (display?.kind === "json") {
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
      } else if (display?.kind === "input_output" && display.output) {
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
        icon: isRunning ? <SpinnerIcon /> : getToolIcon("Block"),
        label,
        preview,
        previewStateKey: preview ? stateKey : undefined,
      };
    }

    case "Agent":
    case "Task":
    case "TaskOutput": {
      const taskDisplay = display?.kind === "task" ? display : undefined;
      const label = isRunning ? (
        <span className="tool-title-shimmer">Delegating task</span>
      ) : taskDisplay ? (
        <span className="inline-flex items-center gap-1.5">
          <span>{taskDisplay.title ?? "Task"}</span>
          <TaskStatusPill status={taskDisplay.status} />
        </span>
      ) : (
        <span>{toolName}</span>
      );

      const preview = taskDisplay ? (
        <PreviewBox
          stateKey={stateKey}
          initialState="peek"
          hasExternalToggle
          peekMaxHeight={220}
          expandedMaxHeight={420}
        >
          {() => <TaskPreview display={taskDisplay} />}
        </PreviewBox>
      ) : null;

      return {
        icon: isRunning ? <SpinnerIcon /> : getToolIcon(toolName),
        label,
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
      } else if (display?.kind === "question") {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="expanded"
            hasExternalToggle
            peekMaxHeight={220}
            expandedMaxHeight={420}
          >
            {() => <QuestionPreview display={display} />}
          </PreviewBox>
        );
      } else if (display?.kind === "task") {
        preview = (
          <PreviewBox
            stateKey={stateKey}
            initialState="peek"
            hasExternalToggle
            peekMaxHeight={220}
            expandedMaxHeight={420}
          >
            {() => <TaskPreview display={display} />}
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
    case "TaskCreate":
    case "TaskGet":
    case "TaskList":
    case "TaskUpdate":
      return "Tasks";
    case "AskUserQuestion":
      return (input.title as string) || (input.prompt as string) || "Question";
    case "Agent":
    case "Task":
      return (
        (input.description as string) ||
        (input.prompt as string) ||
        "Delegated task"
      );
    case "TaskOutput":
      return (
        (input.task_id as string) || (input.agent_id as string) || "Task output"
      );
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
      Boolean(onOpenFileAtLine),
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
        filePath={action.filePath}
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
      Boolean(onOpenFileAtLine),
      { display, isError, outputText },
      toolCallId,
    );

    return (
      <TimelineRow
        icon={action.icon}
        label={action.label}
        isLast={isLast}
        onOpenFileAtLine={action.filePath ? onOpenFileAtLine : undefined}
        filePath={action.filePath}
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
  children,
}: {
  isStreaming: boolean;
  children?: React.ReactNode;
}) {
  return (
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

export function ErrorTimelineRow({
  message,
  isLast = false,
}: {
  message: string;
  isLast?: boolean;
}) {
  return (
    <div className="relative flex gap-3 pb-0.5">
      {!isLast && (
        <div className="absolute left-[9px] top-[24px] bottom-0 w-px bg-border-500" />
      )}
      <div className="relative z-[1] flex size-[20px] shrink-0 items-center justify-center">
        <CircleX className="size-4 text-red-400" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pb-3">
        <div className="text-[12.5px] text-red-300">Request failed</div>
        <div className="rounded-xl border border-red-500/25 bg-red-500/8 px-3 py-2">
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">
            {message}
          </div>
        </div>
      </div>
    </div>
  );
}
