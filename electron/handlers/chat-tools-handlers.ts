import { ipcMain } from "electron";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	defaultBlockDiagram,
	normalizeBlockId,
	parseBlockSchema,
	serializeBlockSchema,
} from "../../src/lib/chat/tools/block-format";
import {
	normalizeContextFilename,
	parseContextMarkdown,
	serializeContextMarkdown,
} from "../../src/lib/chat/tools/context-format";

function execFileAsync(
	command: string,
	args: string[],
	options?: { cwd?: string; timeout?: number; shell?: boolean },
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{
				cwd: options?.cwd,
				timeout: options?.timeout,
				shell: options?.shell,
				maxBuffer: 10 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				if (error) {
					const enriched = Object.assign(error, { stdout, stderr });
					reject(enriched);
					return;
				}
				resolve({ stdout, stderr });
			},
		);
	});
}

function execRipgrepFilesStreaming(
	args: string[],
	options?: { cwd?: string; maxLines?: number },
): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const child = spawn("rg", args, {
			cwd: options?.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdoutBuffer = "";
		let stderr = "";
		const lines: string[] = [];
		const maxLines = options?.maxLines ?? Number.POSITIVE_INFINITY;
		let stoppedEarly = false;

		const pushChunkLines = (chunk: string) => {
			stdoutBuffer += chunk;
			while (true) {
				const newlineIndex = stdoutBuffer.indexOf("\n");
				if (newlineIndex < 0) break;
				const line = stdoutBuffer.slice(0, newlineIndex).trim();
				stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
				if (!line) continue;
				lines.push(line);
				if (lines.length >= maxLines) {
					stoppedEarly = true;
					child.kill();
					return;
				}
			}
		};

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			if (!stoppedEarly) {
				pushChunkLines(chunk);
			}
		});

		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});

		child.on("error", (error) => {
			reject(error);
		});

		child.on("close", (code, signal) => {
			if (stdoutBuffer && !stoppedEarly) {
				const trailing = stdoutBuffer.trim();
				if (trailing) {
					lines.push(trailing);
				}
			}
			if (stoppedEarly || signal === "SIGTERM") {
				resolve(lines);
				return;
			}
			if (code === 0) {
				resolve(lines);
				return;
			}
			if (code === 1) {
				resolve([]);
				return;
			}
			if ((code as number | null) === null) {
				reject(new Error(stderr || "ripgrep terminated unexpectedly."));
				return;
			}
			const error = Object.assign(new Error(stderr || `ripgrep exited with code ${code}`), {
				code,
				stderr,
			});
			reject(error);
		});
	});
}

function parseLines(output: string): string[] {
	return output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function normalizeGlobPattern(pattern: string): string {
	const trimmed = pattern.trim();
	if (!trimmed) {
		return trimmed;
	}
	const isNegated = trimmed.startsWith("!");
	const rawPattern = isNegated ? trimmed.slice(1) : trimmed;
	const normalized = rawPattern.startsWith("**/") ? rawPattern : `**/${rawPattern.replace(/^\/+/, "")}`;
	return isNegated ? `!${normalized}` : normalized;
}

function resolveWorkspacePath(
	requestedPath: string | undefined,
	workspaceRoots: string[],
	options?: { requireWorkspaceRoot?: boolean },
): string {
	const workspaceRoot = workspaceRoots[0];
	const trimmedPath = requestedPath?.trim();

	if (trimmedPath) {
		if (workspaceRoot && (trimmedPath === "/workspace" || trimmedPath.startsWith("/workspace/"))) {
			const relativePath = trimmedPath === "/workspace" ? "" : trimmedPath.slice("/workspace/".length);
			return path.resolve(workspaceRoot, relativePath);
		}
		if (path.isAbsolute(trimmedPath)) {
			return path.resolve(trimmedPath);
		}
		if (workspaceRoot) {
			return path.resolve(workspaceRoot, trimmedPath);
		}
		return path.resolve(trimmedPath);
	}

	if (!workspaceRoot && options?.requireWorkspaceRoot !== false) {
		throw new Error("No workspace is open. Open a project before searching.");
	}
	return workspaceRoot ? path.resolve(workspaceRoot) : "";
}

function resolveSearchPath(requestedPath: string | undefined, workspaceRoots: string[]): string {
	return resolveWorkspacePath(requestedPath, workspaceRoots);
}

function isRipgrepNoMatchError(error: unknown): boolean {
	const code = (error as { code?: unknown })?.code;
	return code === 1 || code === "1" || /code 1|status 1/i.test(String(error));
}

function applyWindow<T>(
	items: T[],
	headLimit: number | undefined,
	offset: number | undefined,
	defaultLimit: number,
): {
	items: T[];
	truncated: boolean;
	appliedLimit?: number;
	appliedOffset?: number;
} {
	const start = Math.max(0, offset ?? 0);
	if (headLimit === 0) {
		return {
			items: items.slice(start),
			truncated: false,
			appliedOffset: start > 0 ? start : undefined,
		};
	}
	const effectiveLimit = headLimit ?? defaultLimit;
	const sliced = items.slice(start, start + effectiveLimit);
	const truncated = items.length - start > effectiveLimit;
	return {
		items: sliced,
		truncated,
		appliedLimit: truncated ? effectiveLimit : undefined,
		appliedOffset: start > 0 ? start : undefined,
	};
}

function toAbsoluteResultPath(searchPath: string, filePath: string): string {
	return path.isAbsolute(filePath) ? filePath : path.join(searchPath, filePath);
}

function parseCountEntries(output: string, searchPath: string): Array<{ path: string; count: number }> {
	return parseLines(output)
		.map((line) => {
			const separatorIndex = line.lastIndexOf(":");
			if (separatorIndex <= 0) return null;
			const filePath = line.slice(0, separatorIndex);
			const count = Number.parseInt(line.slice(separatorIndex + 1), 10);
			if (!Number.isFinite(count)) return null;
			return {
				path: toAbsoluteResultPath(searchPath, filePath),
				count,
			};
		})
		.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function getBackgroundTaskDir(): string {
	const dir = path.join(os.tmpdir(), "prompt-book-chat-tools");
	mkdirSync(dir, { recursive: true });
	return dir;
}

function getContextDir(workspaceRoots: string[]): string {
	const workspaceRoot = workspaceRoots[0];
	if (!workspaceRoot) {
		throw new Error("Context tool requires an open workspace.");
	}
	return path.join(workspaceRoot, ".odex", "context");
}

function getBlocksDir(workspaceRoots: string[]): string {
	const workspaceRoot = workspaceRoots[0];
	if (!workspaceRoot) {
		throw new Error("Block tool requires an open workspace.");
	}
	return path.join(workspaceRoot, ".odex", "blocks");
}

async function readExistingContextFile(
	filePath: string,
	filename: string,
): Promise<ReturnType<typeof parseContextMarkdown> | null> {
	try {
		const content = await fs.readFile(filePath, "utf8");
		return parseContextMarkdown(filename, content);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function readExistingBlockSchema(
	schemaPath: string,
	blockId: string,
): Promise<ReturnType<typeof parseBlockSchema> | null> {
	try {
		const content = await fs.readFile(schemaPath, "utf8");
		return parseBlockSchema(blockId, schemaPath, content);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

function createTaskId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const backgroundTasks = new Map<
	string,
	{
		child: ChildProcess;
		command: string;
		cwd: string;
		outputPath: string;
	}
>();

export function registerChatToolHandlers() {
	ipcMain.handle("chat-tools:glob", async (_event, payload: {
		pattern: string;
		root?: string;
		headLimit?: number;
		offset?: number;
		workspaceRoots?: string[];
	}) => {
		const workspaceRoots = Array.isArray(payload.workspaceRoots) ? payload.workspaceRoots : [];
		const root = resolveSearchPath(payload.root, workspaceRoots);
		const pattern = normalizeGlobPattern(payload.pattern);
		try {
			const effectiveLimit = payload.headLimit === 0 ? undefined : (payload.headLimit ?? 200);
			const offset = Math.max(0, payload.offset ?? 0);
			const maxLines = effectiveLimit === undefined ? undefined : offset + effectiveLimit + 1;
			const matches = await execRipgrepFilesStreaming(
				["--files", root, "--glob", pattern],
				{ maxLines },
			);
			const items = matches.map((filePath) => toAbsoluteResultPath(root, filePath));
			const window = applyWindow(items, payload.headLimit, payload.offset, 200);
			return {
				items: window.items,
				truncated: window.truncated,
			};
		} catch (error) {
			const stderr = typeof (error as { stderr?: string }).stderr === "string"
				? (error as { stderr: string }).stderr
				: "";
			// ripgrep exits 1 when no files match the glob
			if (isRipgrepNoMatchError(error)) {
				return { items: [], truncated: false };
			}
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error("ripgrep (rg) is not installed or not available on PATH.");
			}
			if (/permission denied/i.test(stderr)) {
				throw new Error(`ripgrep could not access part of the search path: ${stderr}`);
			}
			throw new Error(stderr || String(error));
		}
	});

	ipcMain.handle("chat-tools:grep", async (_event, payload: Record<string, unknown>) => {
		const args: string[] = [];
		const outputMode =
			payload.output_mode === "content" || payload.output_mode === "count"
				? payload.output_mode
				: "files_with_matches";

		// Search hidden files and exclude VCS directories
		args.push("--hidden");
		for (const vcsDir of [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"]) {
			args.push("--glob", `!${vcsDir}`);
		}

		// Truncate very long lines to avoid huge output
		args.push("--max-columns", "500");

		// Handle glob patterns — split on commas for multi-glob support
		if (payload.glob && typeof payload.glob === "string") {
			const globs = payload.glob.split(",").map((g) => g.trim()).filter(Boolean);
			for (const g of globs) {
				args.push("--glob", g);
			}
		}
		if (payload.type && typeof payload.type === "string") {
			args.push("--type", payload.type);
		}
		if (payload["-i"] === true) {
			args.push("-i");
		}
		if (payload.multiline === true) {
			args.push("-U", "--multiline-dotall");
		}
		for (const flag of ["-A", "-B", "-C"] as const) {
			if (typeof payload[flag] === "number") {
				args.push(flag, String(payload[flag]));
			}
		}
		if (outputMode === "files_with_matches") {
			args.push("-l");
		} else if (outputMode === "count") {
			args.push("-c");
		} else {
			if (payload["-n"] !== false) {
				args.push("-n");
			}
		}
		const pattern = typeof payload.pattern === "string" ? payload.pattern : "";
		const workspaceRoots = Array.isArray(payload.workspaceRoots)
			? payload.workspaceRoots.filter((value): value is string => typeof value === "string")
			: [];
		const searchPath = resolveSearchPath(
			typeof payload.path === "string" ? payload.path : undefined,
			workspaceRoots,
		);

		// Use -e for patterns that start with a dash to prevent rg misinterpreting them
		if (pattern.startsWith("-")) {
			args.push("-e", pattern, searchPath);
		} else {
			args.push(pattern, searchPath);
		}
		try {
			const { stdout } = await execFileAsync("rg", args);
			if (outputMode === "files_with_matches") {
				const allFiles = parseLines(stdout).map((filePath) => toAbsoluteResultPath(searchPath, filePath));
				const window = applyWindow(
					allFiles,
					typeof payload.head_limit === "number" ? payload.head_limit : undefined,
					typeof payload.offset === "number" ? payload.offset : undefined,
					250,
				);
				return {
					mode: outputMode,
					output: window.items.join("\n"),
					files: window.items,
					truncated: window.truncated,
					appliedLimit: window.appliedLimit,
					appliedOffset: window.appliedOffset,
					counts: [],
				};
			}
			if (outputMode === "count") {
				const allCounts = parseCountEntries(stdout, searchPath);
				const window = applyWindow(
					allCounts,
					typeof payload.head_limit === "number" ? payload.head_limit : undefined,
					typeof payload.offset === "number" ? payload.offset : undefined,
					250,
				);
				return {
					mode: outputMode,
					output: window.items.map((entry) => `${entry.path}: ${entry.count}`).join("\n"),
					files: window.items.map((entry) => entry.path),
					truncated: window.truncated,
					appliedLimit: window.appliedLimit,
					appliedOffset: window.appliedOffset,
					counts: window.items,
				};
			}
			const lines = stdout.replace(/\r\n/g, "\n").split("\n").filter((line) => line.length > 0);
			const window = applyWindow(
				lines,
				typeof payload.head_limit === "number" ? payload.head_limit : undefined,
				typeof payload.offset === "number" ? payload.offset : undefined,
				250,
			);
			return {
				mode: outputMode,
				output: window.items.join("\n"),
				files: [],
				truncated: window.truncated,
				appliedLimit: window.appliedLimit,
				appliedOffset: window.appliedOffset,
				counts: [],
			};
		} catch (error) {
			const stdout = typeof (error as { stdout?: string }).stdout === "string" ? (error as { stdout: string }).stdout : "";
			const stderr = typeof (error as { stderr?: string }).stderr === "string" ? (error as { stderr: string }).stderr : "";
			// ripgrep exits 1 on no matches
			if (isRipgrepNoMatchError(error)) {
				return { mode: outputMode, output: stdout.trim(), files: [], truncated: false, counts: [] };
			}
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw new Error("ripgrep (rg) is not installed or not available on PATH.");
			}
			if (/permission denied/i.test(stderr)) {
				throw new Error(`ripgrep could not access part of the search path: ${stderr}`);
			}
			throw new Error(stderr || String(error));
		}
	});

	ipcMain.handle(
		"chat-tools:context-list",
		async (_event, payload: { workspaceRoots?: string[] }) => {
			const workspaceRoots = Array.isArray(payload.workspaceRoots) ? payload.workspaceRoots : [];
			const contextDir = getContextDir(workspaceRoots);
			let entries;
			try {
				entries = await fs.readdir(contextDir, { withFileTypes: true });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return { items: [] };
				}
				throw error;
			}

			const files = await Promise.all(
				entries
					.filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
					.map(async (entry) => {
						const filePath = path.join(contextDir, entry.name);
						const [stats, content] = await Promise.all([
							fs.stat(filePath),
							fs.readFile(filePath, "utf8"),
						]);
						const parsed = parseContextMarkdown(entry.name, content);
						return {
							filename: entry.name,
							title: parsed.title,
							description: parsed.description,
							path: filePath,
							updatedAt: stats.mtimeMs,
						};
					}),
			);

			files.sort((left, right) => right.updatedAt - left.updatedAt);
			return { items: files };
		},
	);

	ipcMain.handle(
		"chat-tools:context-read",
		async (_event, payload: { filename?: string; workspaceRoots?: string[] }) => {
			const workspaceRoots = Array.isArray(payload.workspaceRoots) ? payload.workspaceRoots : [];
			const filename = normalizeContextFilename(payload.filename ?? "");
			const filePath = path.join(getContextDir(workspaceRoots), filename);
			const content = await fs.readFile(filePath, "utf8");
			const parsed = parseContextMarkdown(filename, content);
			return {
				filename,
				title: parsed.title,
				description: parsed.description,
				path: filePath,
				content: parsed.content,
			};
		},
	);

	ipcMain.handle(
		"chat-tools:context-write",
		async (
			_event,
			payload: {
				filename?: string;
				title?: string;
				description?: string;
				contentBody?: string;
				workspaceRoots?: string[];
			},
		) => {
			const workspaceRoots = Array.isArray(payload.workspaceRoots) ? payload.workspaceRoots : [];
			const filename = normalizeContextFilename(payload.filename ?? "");
			const contentBody = typeof payload.contentBody === "string" ? payload.contentBody.trim() : "";
			if (!contentBody) {
				throw new Error("Context writes require a non-empty content_body.");
			}

			const contextDir = getContextDir(workspaceRoots);
			const filePath = path.join(contextDir, filename);
			const existing = await readExistingContextFile(filePath, filename);
			const nextTitle = typeof payload.title === "string" && payload.title.trim()
				? payload.title.trim()
				: existing?.title ?? "";
			const nextDescription =
				typeof payload.description === "string" && payload.description.trim()
					? payload.description.trim()
					: existing?.description ?? "";

			if (!nextTitle) {
				throw new Error("Creating a new context requires a title.");
			}
			if (!nextDescription) {
				throw new Error("Creating a new context requires a description.");
			}

			await fs.mkdir(contextDir, { recursive: true });
			const pointers = contentBody
				.split(/\n{2,}/)
				.map((entry) => entry.trim())
				.filter(Boolean);
			const content = serializeContextMarkdown({
				title: nextTitle,
				description: nextDescription,
				pointers,
			});
			await fs.writeFile(filePath, content, "utf8");

			return {
				filename,
				title: nextTitle,
				description: nextDescription,
				path: filePath,
				content,
				action: existing ? "updated" : "created",
			};
		},
	);

	ipcMain.handle(
		"chat-tools:block-list",
		async (_event, payload: { workspaceRoots?: string[] }) => {
			const workspaceRoots = Array.isArray(payload.workspaceRoots) ? payload.workspaceRoots : [];
			const blocksDir = getBlocksDir(workspaceRoots);
			let entries;
			try {
				entries = await fs.readdir(blocksDir, { withFileTypes: true });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					return { items: [] };
				}
				throw error;
			}

			const blocks = await Promise.all(
				entries
					.filter((entry) => entry.isDirectory())
					.map(async (entry) => {
						const blockId = normalizeBlockId(entry.name);
						const schemaPath = path.join(blocksDir, blockId, "block.json");
						const parsed = await readExistingBlockSchema(schemaPath, blockId);
						if (!parsed) {
							return null;
						}
						const stats = await fs.stat(schemaPath);
						return {
							id: parsed.id,
							title: parsed.title,
							definition: parsed.definition,
							schemaPath: parsed.schemaPath,
							diagramPath: parsed.diagramPath,
							contextPath: parsed.contextPath,
							files: parsed.files,
							updatedAt: stats.mtimeMs,
						};
					}),
			);

			return {
				items: blocks
					.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
					.sort((left, right) => right.updatedAt - left.updatedAt),
			};
		},
	);

	ipcMain.handle(
		"chat-tools:block-read",
		async (_event, payload: { blockId?: string; workspaceRoots?: string[] }) => {
			const workspaceRoots = Array.isArray(payload.workspaceRoots) ? payload.workspaceRoots : [];
			const blockId = normalizeBlockId(payload.blockId ?? "");
			const schemaPath = path.join(getBlocksDir(workspaceRoots), blockId, "block.json");
			try {
				const content = await fs.readFile(schemaPath, "utf8");
				return parseBlockSchema(blockId, schemaPath, content);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					throw new Error(
						`Block not found: ${blockId}. Call Block with action "list" to inspect existing blocks, or Block with action "write" to create it.`,
					);
				}
				throw error;
			}
		},
	);

	ipcMain.handle(
		"chat-tools:block-write",
		async (
			_event,
			payload: {
				blockId?: string;
				title?: string;
				definition?: string;
				files?: string[];
				diagramFilename?: string;
				diagramContent?: string;
				contextFilename?: string;
				workspaceRoots?: string[];
			},
		) => {
			const workspaceRoots = Array.isArray(payload.workspaceRoots) ? payload.workspaceRoots : [];
			const blockId = normalizeBlockId(payload.blockId ?? "");
			const blocksDir = getBlocksDir(workspaceRoots);
			const blockDir = path.join(blocksDir, blockId);
			const schemaPath = path.join(blockDir, "block.json");
			const existing = await readExistingBlockSchema(schemaPath, blockId);

			const nextTitle = typeof payload.title === "string" && payload.title.trim()
				? payload.title.trim()
				: existing?.title ?? "";
			const nextDefinition = typeof payload.definition === "string" && payload.definition.trim()
				? payload.definition.trim()
				: existing?.definition ?? "";
			const nextFiles = Array.isArray(payload.files)
				? [...new Set(payload.files
						.filter((value): value is string => typeof value === "string")
						.map((value) => resolveWorkspacePath(value, workspaceRoots, { requireWorkspaceRoot: false }))
						.filter(Boolean))].sort((left, right) =>
						left.localeCompare(right),
					)
				: existing?.files ?? [];
			if (!nextTitle) {
				throw new Error("Block writes require a title.");
			}
			if (!nextDefinition) {
				throw new Error("Block writes require a definition.");
			}

			const contextDir = getContextDir(workspaceRoots);
			const nextContextFilename = typeof payload.contextFilename === "string" && payload.contextFilename.trim()
				? normalizeContextFilename(payload.contextFilename)
				: existing?.contextPath
					? path.basename(existing.contextPath)
					: `${blockId}.md`;
			const nextContextPath = path.join(contextDir, nextContextFilename);

			const diagramFilename = typeof payload.diagramFilename === "string" && payload.diagramFilename.trim()
				? payload.diagramFilename.trim()
				: existing?.diagramPath
					? path.basename(existing.diagramPath)
					: "diagram.mmd";
			const diagramPath = path.join(blockDir, diagramFilename);
			let diagramContent = typeof payload.diagramContent === "string" && payload.diagramContent.trim()
				? payload.diagramContent.trim()
				: "";
			if (!diagramContent) {
				if (existing?.diagramPath) {
					try {
						diagramContent = await fs.readFile(existing.diagramPath, "utf8");
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
							throw error;
						}
					}
				}
				if (!diagramContent) {
					diagramContent = defaultBlockDiagram(nextTitle, nextFiles);
				}
			}

			await fs.mkdir(blockDir, { recursive: true });
			await fs.writeFile(diagramPath, `${diagramContent.replace(/\r\n/g, "\n").trim()}\n`, "utf8");

			const schemaContent = serializeBlockSchema({
				title: nextTitle,
				definition: nextDefinition,
				files: nextFiles,
				diagramPath,
				contextPath: nextContextPath,
			});
			await fs.writeFile(schemaPath, schemaContent, "utf8");

			return {
				id: blockId,
				title: nextTitle,
				definition: nextDefinition,
				schemaPath,
				diagramPath,
				contextPath: nextContextPath,
				files: nextFiles,
				action: existing ? "updated" : "created",
			};
		},
	);

	ipcMain.handle(
		"chat-tools:run-command",
		async (
			_event,
			payload: {
				command: string;
				cwd?: string;
				timeoutMs?: number;
				runInBackground?: boolean;
				description?: string;
				workspaceRoots?: string[];
			},
		) => {
			if (!payload.cwd) {
				throw new Error("No working directory specified and no workspace is open.");
			}
			const workspaceRoots = Array.isArray(payload.workspaceRoots)
				? payload.workspaceRoots.filter((value): value is string => typeof value === "string")
				: [];
			const cwd = resolveWorkspacePath(payload.cwd, workspaceRoots, { requireWorkspaceRoot: false }) || payload.cwd;
			if (payload.runInBackground) {
				const taskId = createTaskId();
				const outputPath = path.join(getBackgroundTaskDir(), `${taskId}.log`);
				const child = spawn(
					process.platform === "win32" ? "cmd.exe" : "bash",
					process.platform === "win32"
						? ["/d", "/s", "/c", payload.command]
						: ["-lc", payload.command],
					{
						cwd,
						detached: false,
						stdio: ["ignore", "pipe", "pipe"],
					},
				);
				const stream = createWriteStream(outputPath, { flags: "a" });
				child.stdout?.pipe(stream);
				child.stderr?.pipe(stream);
				child.on("close", () => {
					backgroundTasks.delete(taskId);
					stream.end();
				});
				backgroundTasks.set(taskId, {
					child,
					command: payload.command,
					cwd,
					outputPath,
				});
				return {
					stdout: "",
					stderr: "",
					exitCode: null,
					cwd,
					status: "running" as const,
					backgroundTaskId: taskId,
					outputPath,
				};
			}
			try {
				const { stdout, stderr } = await execFileAsync(
					process.platform === "win32" ? "cmd.exe" : "bash",
					process.platform === "win32"
						? ["/d", "/s", "/c", payload.command]
						: ["-lc", payload.command],
					{ cwd, timeout: payload.timeoutMs ?? 30_000 },
				);
				return { stdout, stderr, exitCode: 0, cwd, status: "completed" as const };
			} catch (error) {
				const stdout = typeof (error as { stdout?: string }).stdout === "string" ? (error as { stdout: string }).stdout : "";
				const stderr = typeof (error as { stderr?: string }).stderr === "string" ? (error as { stderr: string }).stderr : String(error);
				const exitCode =
					typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : 1;
				return { stdout, stderr, exitCode, cwd, status: "completed" as const };
			}
		},
	);

	ipcMain.handle(
		"chat-tools:stop-task",
		async (_event, payload: { taskId?: string }) => {
			const taskId = payload.taskId;
			if (!taskId) {
				throw new Error("Missing required parameter: taskId");
			}
			const task = backgroundTasks.get(taskId);
			if (!task) {
				throw new Error(`No running task found with ID: ${taskId}`);
			}
			task.child.kill();
			backgroundTasks.delete(taskId);
			return {
				taskId,
				command: task.command,
			};
		},
	);
}
