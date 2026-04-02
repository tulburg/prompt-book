import * as React from "react";
import type { ChatMessage } from "@/lib/chat/types";
import type {
	ChatToolDisplay,
	ChatToolDisplayDiff,
	ChatToolDisplayFileList,
	DiffHunk,
	JsonObject,
} from "@/lib/chat/tools/tool-types";

/* ── Primitives ── */

function CodeBlock({ children, maxHeight }: { children: string; maxHeight?: string }) {
	return (
		<pre
			className="overflow-x-auto rounded border border-border-500 bg-panel-500 px-3 py-2 text-[11.5px] leading-relaxed text-foreground font-mono"
			style={maxHeight ? { maxHeight, overflow: "auto" } : undefined}
		>
			<code>{children}</code>
		</pre>
	);
}

function StatusDot({ status }: { status: "success" | "error" | "running" | "neutral" }) {
	const colors: Record<string, string> = {
		success: "bg-green-400",
		error: "bg-red-400",
		running: "bg-sky animate-pulse",
		neutral: "bg-foreground/30",
	};
	return <span className={`inline-block size-2 rounded-full ${colors[status]}`} />;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
	return (
		<svg
			className={`size-3 text-placeholder transition-transform ${expanded ? "rotate-90" : ""}`}
			viewBox="0 0 16 16"
			fill="currentColor"
		>
			<path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
		</svg>
	);
}

function CollapsibleSection({
	label,
	defaultOpen = false,
	children,
}: {
	label: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}) {
	const [open, setOpen] = React.useState(defaultOpen);
	return (
		<div>
			<button
				className="flex w-full cursor-pointer items-center gap-1.5 bg-transparent border-none px-0 py-1 text-[10px] uppercase tracking-wide text-placeholder hover:text-foreground"
				onClick={() => setOpen(!open)}
			>
				<ChevronIcon expanded={open} />
				{label}
			</button>
			{open && <div className="mt-1">{children}</div>}
		</div>
	);
}

/* ── Tool input summarization ── */

function summarizeToolInput(toolName: string, input: JsonObject): string | null {
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

/* ── Card wrapper (Codally-style bordered tool card) ── */

function ToolCard({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={`w-full overflow-hidden rounded border border-border-500 bg-panel-300 ${className ?? ""}`}>
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
			? `Ran \`${description}\``
			: `Ran command`
		: description
			? `Running \`${description}\``
			: "Running command";

	return (
		<ToolCard>
			<ToolCardHeader onClick={() => setExpanded(!expanded)} clickable>
				<ChevronIcon expanded={expanded} />
				<span className="min-w-0 text-[12px] text-foreground">
					{headerLabel.split(/`([^`]+)`/).map((part, i) =>
						i % 2 === 1
							? <code key={i} className="rounded bg-panel-500 px-1 py-0.5 font-mono text-[11px]">{part}</code>
							: <span key={i}>{part}</span>,
					)}
				</span>
				{isRunning && <span className="ml-auto size-2 rounded-full bg-sky animate-pulse" />}
				{hasError && <span className="ml-auto text-[10px] text-red-400">exit {exitCode}</span>}
			</ToolCardHeader>

			{expanded && (
				<div className="border-t border-border-500 bg-panel-500">
					<div className="px-2.5 py-2">
						<pre className="overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-foreground/80">
							<span className="text-placeholder select-none">$ </span>{command}
						</pre>
					</div>

					{hasOutput && (
						<div className="border-t border-border-500 px-2.5 py-2" style={{ maxHeight: "300px", overflow: "auto" }}>
							{display?.stdout && (
								<pre className="overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-foreground/70">
									{display.stdout}
								</pre>
							)}
							{display?.stderr && (
								<pre className="mt-1 overflow-x-auto whitespace-pre font-mono text-[11px] leading-relaxed text-red-400/80">
									{display.stderr}
								</pre>
							)}
						</div>
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
	const fileName = display.filePath.split("/").pop() || display.filePath;
	const dirPath = shortenPath(display.filePath.split("/").slice(0, -1).join("/"));

	return (
		<ToolCard>
			<ToolCardHeader onClick={() => hasHunks && setExpanded(!expanded)} clickable={hasHunks}>
				<span className="text-[12px]">📄</span>
				<span className="min-w-0 truncate text-[12px] text-foreground">{fileName}</span>
				{dirPath && <span className="text-[10px] text-placeholder truncate">{dirPath}</span>}
				<span className="ml-auto flex gap-1.5 text-[11px] font-medium tabular-nums">
					{display.additions > 0 && <span className="text-green-400">+{display.additions}</span>}
					{display.deletions > 0 && <span className="text-red-400">-{display.deletions}</span>}
				</span>
				{hasHunks && <ChevronIcon expanded={expanded} />}
			</ToolCardHeader>
			{expanded && hasHunks && (
				<div className="overflow-x-auto border-t border-border-500 divide-y divide-border-500" style={{ maxHeight: "400px", overflow: "auto" }}>
					{display.hunks.map((hunk, i) => (
						<DiffHunkView key={`hunk-${i}`} hunk={hunk} />
					))}
				</div>
			)}
			{!hasHunks && display.action === "created" && (
				<div className="border-t border-border-500 px-2.5 py-1 text-[11px] text-placeholder">New file created</div>
			)}
		</ToolCard>
	);
}

/* ── IO card (Read, Grep, Write fallback, etc.) ── */

function IOCard({
	display,
	toolName,
}: {
	display: Extract<ChatToolDisplay, { kind: "input_output" }>;
	toolName: string;
}) {
	const [expanded, setExpanded] = React.useState(display.isError === true);
	const title = display.title || toolName;
	const hasOutput = Boolean(display.output);

	return (
		<ToolCard>
			<ToolCardHeader onClick={() => setExpanded(!expanded)} clickable>
				<StatusDot status={display.isError ? "error" : "success"} />
				<span className="min-w-0 truncate text-[12px] text-foreground">{title}</span>
				{display.subtitle && (
					<span className="text-[10px] text-placeholder truncate">{display.subtitle}</span>
				)}
				<ChevronIcon expanded={expanded} />
			</ToolCardHeader>
			{expanded && (
				<div className="border-t border-border-500 px-2.5 py-2 space-y-2">
					<CollapsibleSection label="Input">
						<CodeBlock maxHeight="200px">{display.input}</CodeBlock>
					</CollapsibleSection>
					{hasOutput && (
						<CollapsibleSection label="Output" defaultOpen={display.isError}>
							<CodeBlock maxHeight="300px">{display.output!}</CodeBlock>
						</CollapsibleSection>
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
	const count = items.length;
	const title = display.title || toolName;

	return (
		<ToolCard>
			<ToolCardHeader onClick={() => setExpanded(!expanded)} clickable>
				<span className="text-green-400 text-[12px]">✓</span>
				<span className="min-w-0 truncate text-[12px] text-foreground">{title}</span>
				<span className="text-[10px] text-placeholder">{count} result{count !== 1 ? "s" : ""}</span>
				{display.subtitle && <span className="text-[10px] text-placeholder truncate">{display.subtitle}</span>}
				<ChevronIcon expanded={expanded} />
			</ToolCardHeader>
			{expanded && (
				<div className="border-t border-border-500 max-h-[300px] overflow-y-auto">
					<div className="divide-y divide-border-500">
						{items.map((item) => (
							<div key={item.value} className="px-2.5 py-1.5 text-[11.5px]">
								<div className="text-foreground break-all font-mono">{item.title ?? shortenPath(item.value)}</div>
								{item.description && (
									<div className="mt-0.5 whitespace-pre-wrap break-words text-[10px] text-placeholder">{item.description}</div>
								)}
							</div>
						))}
					</div>
					{display.truncated && (
						<div className="px-2.5 py-1 text-[10px] text-placeholder">Results truncated</div>
					)}
				</div>
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

function TodoCard({ display }: { display: Extract<ChatToolDisplay, { kind: "todo_list" }> }) {
	return (
		<ToolCard>
			<ToolCardHeader>
				<span className="text-[12px]">☑️</span>
				<span className="text-[12px] font-medium text-foreground">{display.title ?? "Tasks"}</span>
			</ToolCardHeader>
			<div className="border-t border-border-500 divide-y divide-border-500">
				{display.items.map((item) => (
					<div key={item.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[11.5px]">
						<span className="text-placeholder">{TODO_STATUS_ICONS[item.status] ?? "○"}</span>
						<span className={`flex-1 ${item.status === "completed" ? "text-placeholder line-through" : item.status === "cancelled" ? "text-placeholder" : "text-foreground"}`}>
							{item.content}
						</span>
					</div>
				))}
			</div>
		</ToolCard>
	);
}

/* ── Standalone tool_use card (when no paired result yet) ── */

function ToolInvocationCard({ toolName, input }: { toolName: string; input: JsonObject }) {
	const summary = summarizeToolInput(toolName, input);

	return (
		<ToolCard>
			<ToolCardHeader>
				<span className="size-2 rounded-full bg-sky animate-pulse" />
				<span className="text-[12px] font-medium text-foreground">{toolName}</span>
				{summary && <span className="min-w-0 truncate text-[11px] text-placeholder">{summary}</span>}
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
						<span className="text-[12px] font-medium text-foreground">{toolName}</span>
					</ToolCardHeader>
					<div className="border-t border-border-500 px-2.5 py-2">
						<CodeBlock maxHeight="300px">{result.outputText}</CodeBlock>
					</div>
				</ToolCard>
			);
		}

		return <ToolDisplayCard display={display} toolName={toolName} input={input} />;
	}

	// Standalone tool_result (no paired tool_use found)
	if (message.subtype === "tool_result" && message.toolResult) {
		const { display, toolName, input, outputText, isError } = message.toolResult;
		if (!display) {
			return (
				<ToolCard>
					<ToolCardHeader>
						<StatusDot status={isError ? "error" : "success"} />
						<span className="text-[12px] font-medium text-foreground">{toolName}</span>
					</ToolCardHeader>
					<div className="border-t border-border-500 px-2.5 py-2">
						<CodeBlock maxHeight="300px">{outputText}</CodeBlock>
					</div>
				</ToolCard>
			);
		}
		return <ToolDisplayCard display={display} toolName={toolName} input={input} />;
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
			return <TerminalCard toolName={toolName} input={input} display={display} />;
		case "diff":
			return <DiffCard display={display} />;
		case "input_output":
			return <IOCard display={display} toolName={toolName} />;
		case "file_list":
			return <ListCard display={display} toolName={toolName} />;
		case "todo_list":
			return <TodoCard display={display} />;
		case "json":
			return (
				<ToolCard>
					<ToolCardHeader>
						<StatusDot status="success" />
						<span className="text-[12px] font-medium text-foreground">{toolName}</span>
					</ToolCardHeader>
					<div className="border-t border-border-500 px-2.5 py-2">
						<CodeBlock maxHeight="300px">{JSON.stringify(display.value, null, 2)}</CodeBlock>
					</div>
				</ToolCard>
			);
		case "text":
		default:
			return (
				<ToolCard>
					<ToolCardHeader>
						<StatusDot status="success" />
						<span className="text-[12px] font-medium text-foreground">{toolName}</span>
					</ToolCardHeader>
					<div className="border-t border-border-500 px-2.5 py-2 text-[12px] text-foreground whitespace-pre-wrap">
						{display.text}
					</div>
				</ToolCard>
			);
	}
}
