import type { ChatToolDefinition } from "@/lib/chat/tools/tool-types";

import { coerceNumber, coerceString, errorResult, textResult } from "./helpers";

// ── Command classification sets (ported from Claude Code) ──────────────────

const SEARCH_COMMANDS = new Set([
	"find", "grep", "rg", "ag", "ack", "locate", "which", "whereis",
]);

const READ_COMMANDS = new Set([
	"cat", "head", "tail", "less", "more",
	"wc", "stat", "file", "strings",
	"jq", "awk", "cut", "sort", "uniq", "tr",
]);

const LIST_COMMANDS = new Set(["ls", "tree", "du"]);

const SEMANTIC_NEUTRAL_COMMANDS = new Set(["echo", "printf", "true", "false", ":"]);

const SILENT_COMMANDS = new Set([
	"mv", "cp", "rm", "mkdir", "rmdir", "chmod", "chown", "chgrp",
	"touch", "ln", "cd", "export", "unset", "wait",
]);

const WRITE_INDICATORS = [
	">", ">>", ">&",
	"rm ", "mv ", "cp ", "touch ", "mkdir ", "rmdir ",
	"sed -i", "git add", "git commit", "git push",
	"git reset", "git checkout",
	"npm install", "pnpm add", "yarn add",
];

const GIT_READONLY_PREFIXES = ["git status", "git diff", "git log", "git branch", "git remote", "git show", "git tag"];

// ── Output limits ──────────────────────────────────────────────────────────

const MAX_RESULT_CHARS = 30_000;
const MAX_TIMEOUT_MS = 600_000;

// ── Compound command splitting ─────────────────────────────────────────────

function splitCommandParts(command: string): string[] {
	const parts: string[] = [];
	let current = "";
	let depth = 0;
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		const next = command[i + 1];

		if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue; }
		if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }
		if (inSingle || inDouble) { current += ch; continue; }

		if (ch === "(" || ch === "{") { depth++; current += ch; continue; }
		if (ch === ")" || ch === "}") { depth--; current += ch; continue; }

		if (depth > 0) { current += ch; continue; }

		if (ch === "|" && next === "|") { pushPart(); parts.push("||"); i++; continue; }
		if (ch === "&" && next === "&") { pushPart(); parts.push("&&"); i++; continue; }
		if (ch === "|") { pushPart(); parts.push("|"); continue; }
		if (ch === ";") { pushPart(); parts.push(";"); continue; }

		current += ch;
	}
	pushPart();
	return parts;

	function pushPart() {
		const trimmed = current.trim();
		if (trimmed) parts.push(trimmed);
		current = "";
	}
}

const OPERATORS = new Set(["||", "&&", "|", ";"]);
const REDIRECTS = new Set([">", ">>", ">&"]);

function baseCommandOf(part: string): string {
	const tokens = part.trim().split(/\s+/);
	// skip leading env assignments like FOO=bar
	for (const token of tokens) {
		if (!/^[A-Za-z_]\w*=/.test(token)) return token;
	}
	return tokens[0] ?? "";
}

export function classifyCommand(command: string): {
	isSearch: boolean;
	isRead: boolean;
	isList: boolean;
	isSilent: boolean;
	isReadOnly: boolean;
} {
	const parts = splitCommandParts(command);
	if (parts.length === 0) {
		return { isSearch: false, isRead: false, isList: false, isSilent: false, isReadOnly: false };
	}

	let hasSearch = false;
	let hasRead = false;
	let hasList = false;
	let allSilent = true;
	let allReadOnly = true;
	let hasNonNeutral = false;
	let skipNext = false;
	const normalized = command.trim().replace(/\s+/g, " ").toLowerCase();

	if (WRITE_INDICATORS.some((ind) => normalized.includes(ind))) {
		allReadOnly = false;
	}

	for (const part of parts) {
		if (skipNext) { skipNext = false; continue; }
		if (OPERATORS.has(part)) continue;
		if (REDIRECTS.has(part)) { skipNext = true; allReadOnly = false; allSilent = false; continue; }

		const base = baseCommandOf(part).toLowerCase();
		if (!base) continue;
		if (SEMANTIC_NEUTRAL_COMMANDS.has(base)) continue;

		hasNonNeutral = true;

		const partIsSearch = SEARCH_COMMANDS.has(base);
		const partIsRead = READ_COMMANDS.has(base);
		const partIsList = LIST_COMMANDS.has(base);
		const partIsSilent = SILENT_COMMANDS.has(base);

		if (partIsSearch) hasSearch = true;
		if (partIsRead) hasRead = true;
		if (partIsList) hasList = true;
		if (!partIsSilent) allSilent = false;
		if (!partIsSearch && !partIsRead && !partIsList &&
			!GIT_READONLY_PREFIXES.some((p) => normalized === p || normalized.startsWith(`${p} `))) {
			if (!["pwd", "env", "printenv", "hostname", "whoami", "date", "uname", "id"].includes(base)) {
				allReadOnly = false;
			}
		}
	}

	if (!hasNonNeutral) {
		return { isSearch: false, isRead: false, isList: false, isSilent: false, isReadOnly: true };
	}

	return {
		isSearch: hasSearch,
		isRead: hasRead,
		isList: hasList,
		isSilent: allSilent,
		isReadOnly: allReadOnly && !WRITE_INDICATORS.some((ind) => normalized.includes(ind)),
	};
}

// ── Exit code semantic interpretation ──────────────────────────────────────

interface CommandInterpretation {
	isError: boolean;
	message?: string;
}

function interpretExitCode(command: string, exitCode: number | null, _stdout: string): CommandInterpretation {
	if (exitCode === null || exitCode === 0) {
		return { isError: false };
	}

	const base = baseCommandOf(command).toLowerCase();

	// grep/rg exit 1 = no matches (not an error)
	if ((base === "grep" || base === "rg" || base === "ag" || base === "ack") && exitCode === 1) {
		return { isError: false, message: "No matches found." };
	}

	// diff exit 1 = files differ (not an error)
	if (base === "diff" && exitCode === 1) {
		return { isError: false, message: "Files differ." };
	}

	// test/[ exit 1 = condition false (not an error)
	if ((base === "test" || base === "[") && exitCode === 1) {
		return { isError: false, message: "Test condition evaluated to false." };
	}

	// curl: various non-zero codes aren't necessarily failures
	if (base === "curl" && exitCode === 22) {
		return { isError: true, message: "HTTP error response (curl exit 22)." };
	}

	// exit 130 = SIGINT, 137 = SIGKILL, 143 = SIGTERM
	if (exitCode === 130) return { isError: true, message: "Command interrupted (SIGINT)." };
	if (exitCode === 137) return { isError: true, message: "Command killed (SIGKILL — likely OOM or timeout)." };
	if (exitCode === 143) return { isError: true, message: "Command terminated (SIGTERM)." };

	// exit 126 = permission denied, 127 = command not found
	if (exitCode === 126) return { isError: true, message: "Permission denied or not executable." };
	if (exitCode === 127) return { isError: true, message: "Command not found." };

	return { isError: true };
}

// ── Sleep pattern detection ────────────────────────────────────────────────

function detectBlockedSleepPattern(command: string): string | null {
	const parts = splitCommandParts(command);
	if (parts.length === 0) return null;
	const first = parts[0]?.trim() ?? "";
	const m = /^sleep\s+(\d+)\s*$/.exec(first);
	if (!m) return null;
	const secs = Number.parseInt(m[1]!, 10);
	if (secs < 2) return null;

	const rest = parts.slice(1)
		.filter((p) => !OPERATORS.has(p))
		.join(" ")
		.trim();
	return rest ? `sleep ${secs} followed by: ${rest}` : `standalone sleep ${secs}`;
}

// ── Output truncation ──────────────────────────────────────────────────────

function truncateOutput(output: string, maxChars: number): { text: string; wasTruncated: boolean } {
	if (output.length <= maxChars) {
		return { text: output, wasTruncated: false };
	}
	const headSize = Math.floor(maxChars * 0.8);
	const tailSize = maxChars - headSize - 100;
	const head = output.slice(0, headSize);
	const tail = output.slice(-tailSize);
	const skipped = output.length - headSize - tailSize;
	return {
		text: `${head}\n\n... [${skipped} characters truncated] ...\n\n${tail}`,
		wasTruncated: true,
	};
}

// ── Tool definition ────────────────────────────────────────────────────────

export const bashTool: ChatToolDefinition = {
	name: "Bash",
	source: "claude",
	category: "shell",
	uiKind: "command",
	description: "Run a shell command in the workspace.",
	inputSchema: {
		type: "object",
		properties: {
			command: {
				type: "string",
				description: "Shell command to execute.",
			},
			description: {
				type: "string",
				description: [
					"Clear, concise description of what this command does in active voice.",
					"For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):",
					'  ls → "List files in current directory"',
					'  git status → "Show working tree status"',
					"For harder-to-parse commands (piped commands, obscure flags), add enough context:",
					'  find . -name "*.tmp" -exec rm {} \\; → "Find and delete all .tmp files recursively"',
					'  curl -s url | jq \'.data[]\' → "Fetch JSON from URL and extract data array elements"',
				].join("\n"),
			},
			timeout: {
				type: "integer",
				description: `Optional timeout in milliseconds (max ${MAX_TIMEOUT_MS}).`,
			},
			run_in_background: {
				type: "boolean",
				description: "Set true to run the command in the background. Use Read to read the output later.",
			},
			cwd: {
				type: "string",
				description: "Legacy alias for working directory.",
			},
			working_directory: {
				type: "string",
				description: "Optional working directory.",
			},
		},
		required: ["command"],
		additionalProperties: false,
	},
	readOnly(input) {
		return classifyCommand(coerceString(input.command)).isReadOnly;
	},
	concurrencySafe(input) {
		return classifyCommand(coerceString(input.command)).isReadOnly;
	},
	summarize(input) {
		return coerceString(input.description) || coerceString(input.command) || null;
	},
	async execute(input, context) {
		const command = coerceString(input.command);
		if (!command) {
			return errorResult("No command provided.");
		}

		// Block problematic sleep patterns
		const sleepPattern = detectBlockedSleepPattern(command);
		if (sleepPattern) {
			return errorResult(
				`Blocked: ${sleepPattern}. Use run_in_background: true for long-running commands. ` +
				"If you need a short delay (rate limiting), keep it under 2 seconds.",
			);
		}

		const cwd =
			coerceString(input.working_directory) || coerceString(input.cwd) || undefined;
		const rawTimeout = coerceNumber(input.timeout, 30_000);
		const timeoutMs = Math.min(Math.max(rawTimeout, 0), MAX_TIMEOUT_MS);
		const runInBackground = input.run_in_background === true;

		const result = await context.runCommand({
			command,
			cwd,
			timeoutMs,
			runInBackground,
			description: coerceString(input.description),
		});

		// Background tasks return immediately
		if (result.status === "running") {
			return textResult(
				`Command is running in the background with ID: ${result.backgroundTaskId ?? "unknown"}.` +
				(result.outputPath ? ` Output: ${result.outputPath}` : ""),
				{
					kind: "command",
					title: coerceString(input.description) || "Shell command",
					command,
					cwd: result.cwd,
					stdout: "",
					stderr: "",
					exitCode: null,
					status: "running",
					backgroundTaskId: result.backgroundTaskId,
					outputPath: result.outputPath,
				},
			);
		}

		const classification = classifyCommand(command);
		const interpretation = interpretExitCode(command, result.exitCode, result.stdout);

		// Combine and truncate output
		const rawOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
		const { text: output, wasTruncated } = truncateOutput(rawOutput, MAX_RESULT_CHARS);

		let content: string;
		if (interpretation.isError) {
			const parts = [output];
			if (result.exitCode !== null && result.exitCode !== 0) {
				parts.push(`Exit code ${result.exitCode}`);
			}
			if (interpretation.message) {
				parts.push(interpretation.message);
			}
			content = parts.filter(Boolean).join("\n");
		} else if (!output && classification.isSilent) {
			content = "Done.";
		} else if (!output) {
			content = interpretation.message || `Command exited with ${result.exitCode ?? "unknown"}.`;
		} else {
			const suffix = interpretation.message ? `\n${interpretation.message}` : "";
			const truncNote = wasTruncated
				? "\n(Output was truncated. Run with head/tail to see specific portions.)"
				: "";
			content = `${output}${suffix}${truncNote}`;
		}

		return textResult(content, {
			kind: "command",
			title: coerceString(input.description) || "Shell command",
			command,
			cwd: result.cwd,
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
			status: result.status ?? "completed",
			backgroundTaskId: result.backgroundTaskId,
			outputPath: result.outputPath,
		});
	},
	availability: () => ({ supported: true }),
};
