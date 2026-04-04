import type { ChatMode } from "@/lib/chat/types";

import { getAvailableChatTools } from "./tool-registry";
import type { ChatToolContext, JsonObject } from "./tool-types";

function getProjectBridge() {
	return typeof window === "undefined" ? undefined : window.projectBridge;
}

function splitParentPath(filePath: string): { parentPath: string; name: string } {
	const normalized = filePath.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	if (lastSlash <= 0) {
		return { parentPath: normalized.slice(0, lastSlash + 1) || "/", name: normalized.slice(lastSlash + 1) };
	}
	return {
		parentPath: normalized.slice(0, lastSlash),
		name: normalized.slice(lastSlash + 1),
	};
}

function normalizePath(filePath: string): string {
	return filePath.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

function normalizeLineEndings(content: string): string {
	return content.replace(/\r\n/g, "\n");
}

function restoreLineEndings(content: string, original: string): string {
	return original.includes("\r\n") ? content.replace(/\n/g, "\r\n") : content;
}

function isWithinWorkspace(filePath: string, workspaceRoots: string[]): boolean {
	if (workspaceRoots.length === 0) return true;
	const normalizedPath = normalizePath(filePath);
	return workspaceRoots.some((root) => {
		const normalizedRoot = normalizePath(root);
		return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
	});
}

function ensureWorkspacePath(filePath: string, workspaceRoots: string[], description: string): string {
	if (!isWithinWorkspace(filePath, workspaceRoots)) {
		throw new Error(`${description} must stay within the open workspace roots.`);
	}
	return filePath;
}

async function ensureProjectBridge() {
	const projectBridge = getProjectBridge();
	if (!projectBridge) {
		throw new Error("Project access is unavailable in this environment.");
	}
	return projectBridge;
}

function replaceOccurrences(
	content: string,
	oldString: string,
	newString: string,
	replaceAll: boolean,
): { content: string; replacements: number; error?: string } {
	if (!oldString) {
		return { content: `${newString}${content}`, replacements: 1 };
	}
	const occurrences = content.split(oldString).length - 1;
	if (occurrences === 0) {
		return { content, replacements: 0, error: "No exact matches found." };
	}
	if (!replaceAll && occurrences > 1) {
		return {
			content,
			replacements: 0,
			error: "Multiple exact matches found. Narrow old_string or set replace_all to true.",
		};
	}
	if (replaceAll) {
		const parts = content.split(oldString);
		return {
			content: parts.join(newString),
			replacements: parts.length - 1,
		};
	}
	const index = content.indexOf(oldString);
	return {
		content: `${content.slice(0, index)}${newString}${content.slice(index + oldString.length)}`,
		replacements: 1,
	};
}

function getReadWindow(
	lines: string[],
	offset?: number,
	limit?: number,
): {
	startIndex: number;
	selected: string[];
	truncated: boolean;
	isPartial: boolean;
} {
	const DEFAULT_READ_LINES = 400;
	const MAX_READ_LINES = 2_000;
	const effectiveLimit =
		limit === undefined ? DEFAULT_READ_LINES : Math.max(0, Math.min(limit, MAX_READ_LINES));
	const startIndex =
		offset === undefined
			? 0
			: offset >= 0
				? Math.max(offset - 1, 0)
				: Math.max(lines.length + offset, 0);
	const endIndex = effectiveLimit === 0 ? startIndex : startIndex + effectiveLimit;
	const selected = lines.slice(startIndex, endIndex);
	return {
		startIndex,
		selected,
		truncated: endIndex < lines.length,
		isPartial: offset !== undefined || limit !== undefined || endIndex < lines.length,
	};
}

function detectFileType(filePath: string, content: string): {
	fileType: "text" | "notebook" | "image" | "pdf" | "binary";
	unsupportedMessage?: string;
} {
	if (/\.ipynb$/i.test(filePath)) {
		return { fileType: "notebook" };
	}
	if (/\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(filePath)) {
		return {
			fileType: "image",
			unsupportedMessage: "Image files are not yet supported by the local Read tool.",
		};
	}
	if (/\.pdf$/i.test(filePath)) {
		return {
			fileType: "pdf",
			unsupportedMessage: "PDF files are not yet supported by the local Read tool.",
		};
	}
	if (content.includes("\u0000")) {
		return {
			fileType: "binary",
			unsupportedMessage: "Binary files are not supported by the local Read tool.",
		};
	}
	return { fileType: "text" };
}

async function getWorkspaceRoots(): Promise<string[]> {
	const projectBridge = getProjectBridge();
	if (!projectBridge) return [];
	const snapshot = await projectBridge.restoreLastProject();
	return snapshot?.roots.map((root) => root.path) ?? [];
}

type TodoItem = {
	id: string;
	content: string;
	status: "pending" | "in_progress" | "completed" | "cancelled";
};

type ReadSnapshot = {
	content: string;
	isPartial: boolean;
	fileType: "text" | "notebook" | "image" | "pdf" | "binary";
};

function isMissingFileError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /ENOENT|exist|not found|no such file/i.test(message);
}

export function createToolContext(options: {
	sessionId: string;
	modelId: string | null;
	signal: AbortSignal;
	stopGeneration: () => void;
	setMode: (mode: ChatMode) => void;
	getTodos: () => TodoItem[];
	setTodos: (items: TodoItem[], merge: boolean) => TodoItem[];
}): Promise<ChatToolContext> {
	return (async () => {
		const workspaceRoots = await getWorkspaceRoots();
		const readSnapshots = new Map<string, ReadSnapshot>();

		const readRawFile = async (path: string) => {
			const projectBridge = await ensureProjectBridge();
			const result = await projectBridge.readFile(path);
			return result.content;
		};

		const ensureFreshFullRead = async (path: string) => {
			const snapshot = readSnapshots.get(path);
			if (!snapshot || snapshot.isPartial) {
				throw new Error("File has not been read fully yet. Read it first before modifying it.");
			}
			const current = normalizeLineEndings(await readRawFile(path));
			if (snapshot.content !== current) {
				throw new Error("File has changed since it was read. Read it again before modifying it.");
			}
			return { current, snapshot };
		};

		const writeFile = async (path: string, content: string) => {
			ensureWorkspacePath(path, workspaceRoots, "Tool file access");
			const projectBridge = await ensureProjectBridge();
			try {
				const current = await readRawFile(path);
				const normalizedCurrent = normalizeLineEndings(current);
				const snapshot = readSnapshots.get(path);
				if (!snapshot || snapshot.isPartial) {
					throw new Error("File has not been read fully yet. Read it first before modifying it.");
				}
				if (snapshot.content !== normalizedCurrent) {
					throw new Error("File has changed since it was read. Read it again before modifying it.");
				}
				await projectBridge.writeFile(path, restoreLineEndings(content, current));
				readSnapshots.set(path, {
					content: normalizeLineEndings(content),
					isPartial: false,
					fileType: snapshot.fileType,
				});
				return { action: "overwritten" as const, originalContent: normalizedCurrent };
			} catch (error) {
				if (!isMissingFileError(error)) {
					throw error;
				}
				const { parentPath, name } = splitParentPath(path);
				ensureWorkspacePath(parentPath, workspaceRoots, "Tool file access");
				await projectBridge.createFile(parentPath, name, content);
				readSnapshots.set(path, {
					content: normalizeLineEndings(content),
					isPartial: false,
					fileType: detectFileType(path, content).fileType,
				});
				return { action: "created" as const };
			}
		};

		const editFile = async (
			path: string,
			oldString: string,
			newString: string,
			replaceAll?: boolean,
		) => {
			ensureWorkspacePath(path, workspaceRoots, "Tool file access");
			if (/\.ipynb$/i.test(path)) {
				throw new Error("Jupyter notebooks must be edited with NotebookEdit.");
			}
			try {
				const { current } = await ensureFreshFullRead(path);
				if (oldString === "" && current.trim().length > 0) {
					return {
						content: current,
						replacements: 0,
						action: "edited" as const,
						error: "Cannot create a new file because the target file already exists and is not empty.",
					};
				}
				const next = replaceOccurrences(
					current,
					normalizeLineEndings(oldString),
					normalizeLineEndings(newString),
					Boolean(replaceAll),
				);
				if (next.replacements > 0) {
					await writeFile(path, next.content);
				}
				return { ...next, originalContent: current, action: "edited" as const };
			} catch (error) {
				if (!isMissingFileError(error)) {
					throw error;
				}
				if (oldString !== "") {
					throw new Error(`File does not exist: ${path}`);
				}
				const created = await writeFile(path, normalizeLineEndings(newString));
				return {
					content: normalizeLineEndings(newString),
					replacements: 1,
					action: (created.action === "created" ? "created" : "edited") as "created" | "edited",
				};
			}
		};

		const writeNotebookCell = async (input: {
			notebookPath: string;
			cellId?: string;
			newSource: string;
			cellType?: "code" | "markdown";
			editMode?: "replace" | "insert" | "delete";
		}) => {
			const notebookPath = ensureWorkspacePath(
				input.notebookPath,
				workspaceRoots,
				"Notebook edits",
			);
			const { current } = await ensureFreshFullRead(notebookPath);
			let parsed: {
				cells?: Array<{
					id?: string;
					cell_type: "code" | "markdown";
					source: string[] | string;
					metadata?: JsonObject;
				}>;
			};
			try {
				parsed = JSON.parse(current) as typeof parsed;
			} catch {
				throw new Error("Notebook file is not valid JSON.");
			}
			const cells = Array.isArray(parsed.cells) ? [...parsed.cells] : [];
			const editMode = input.editMode ?? "replace";

			// Resolve cell id: support "cell-N" form, UUID strings, and index strings
			let normalizedCellId = input.cellId;
			if (normalizedCellId !== undefined) {
				const cellNumMatch = /^cell-(\d+)$/.exec(normalizedCellId);
				if (cellNumMatch) {
					normalizedCellId = cellNumMatch[1];
				}
			}

			const resolvedIndex =
				normalizedCellId === undefined
					? undefined
					: cells.findIndex((cell, index) => cell.id === normalizedCellId || String(index) === normalizedCellId);
			if (normalizedCellId !== undefined && resolvedIndex === -1) {
				throw new Error(`Cell not found: ${input.cellId}`);
			}
			const nextCell = {
				id: crypto.randomUUID(),
				cell_type: input.cellType ?? "code",
				source: input.newSource
					.split("\n")
					.map((line, index, lines) => (index < lines.length - 1 ? `${line}\n` : line)),
				metadata: {},
			};
			let editedCellId = input.cellId;
			let resultingCellType: "code" | "markdown" | undefined;
			if (editMode === "delete") {
				if (resolvedIndex === undefined || resolvedIndex < 0) {
					throw new Error("Cell ID is required when deleting a notebook cell.");
				}
				cells.splice(resolvedIndex, 1);
			} else if (editMode === "insert") {
				const insertIndex = resolvedIndex === undefined || resolvedIndex < 0 ? 0 : resolvedIndex + 1;
				cells.splice(insertIndex, 0, nextCell);
				editedCellId = nextCell.id;
				resultingCellType = nextCell.cell_type;
			} else {
				if (resolvedIndex === undefined || resolvedIndex < 0) {
					// Replace past end → insert at the end
					cells.push(nextCell);
					editedCellId = nextCell.id;
					resultingCellType = nextCell.cell_type;
				} else {
					const currentCell = cells[resolvedIndex];
					const cellType = input.cellType ?? currentCell?.cell_type ?? "code";
					const replacedCell: typeof cells[number] = {
						...currentCell,
						cell_type: cellType,
						source: nextCell.source,
					};
					// Clear execution state when replacing code cell content
					if (cellType === "code") {
						const raw = replacedCell as Record<string, unknown>;
						raw.outputs = [];
						raw.execution_count = null;
					}
					cells[resolvedIndex] = replacedCell;
					editedCellId = currentCell?.id ?? input.cellId;
					resultingCellType = cellType;
				}
			}
			parsed.cells = cells;
			const serializedNotebook = JSON.stringify(parsed, null, 2);
			await writeFile(notebookPath, serializedNotebook);
			return {
				serializedNotebook,
				editedCellId,
				cellType: resultingCellType,
				editMode,
			};
		};

		const searchWeb = async (input: {
			query: string;
			explanation?: string;
			allowedDomains?: string[];
			blockedDomains?: string[];
		}) => {
			const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(input.query)}&format=json&no_html=1&skip_disambig=1`;
			const response = await fetch(url, { signal: options.signal });
			if (!response.ok) {
				throw new Error(`Web search failed: ${response.status}`);
			}
			const payload = await response.json() as {
				AbstractText?: string;
				AbstractURL?: string;
				Heading?: string;
				RelatedTopics?: Array<
					| { Text?: string; FirstURL?: string }
					| { Topics?: Array<{ Text?: string; FirstURL?: string }> }
				>;
			};
			const results: Array<{ title: string; url: string; snippet: string }> = [];
			if (payload.AbstractText && payload.AbstractURL) {
				results.push({
					title: payload.Heading || payload.AbstractURL,
					url: payload.AbstractURL,
					snippet: payload.AbstractText,
				});
			}
			for (const topic of payload.RelatedTopics ?? []) {
				if ("Topics" in topic && Array.isArray(topic.Topics)) {
					for (const child of topic.Topics) {
						if (child.Text && child.FirstURL) {
							results.push({
								title: child.Text.split(" - ")[0] || child.FirstURL,
								url: child.FirstURL,
								snippet: child.Text,
							});
						}
					}
					continue;
				}
				if ("Text" in topic && topic.Text && topic.FirstURL) {
					results.push({
						title: topic.Text.split(" - ")[0] || topic.FirstURL,
						url: topic.FirstURL,
						snippet: topic.Text,
					});
				}
			}
			const allowed = new Set((input.allowedDomains ?? []).map((domain) => domain.toLowerCase()));
			const blocked = new Set((input.blockedDomains ?? []).map((domain) => domain.toLowerCase()));
			return results
				.filter((result) => {
					try {
						const hostname = new URL(result.url).hostname.toLowerCase();
						if (blocked.has(hostname)) return false;
						if (allowed.size > 0 && !allowed.has(hostname)) return false;
						return true;
					} catch {
						return allowed.size === 0;
					}
				})
				.slice(0, 10);
		};

		let context!: ChatToolContext;
		context = {
			sessionId: options.sessionId,
			modelId: options.modelId,
			workspaceRoots,
			signal: options.signal,
			stopGeneration: options.stopGeneration,
			setMode: options.setMode,
			async readFile(path, readOptions) {
				const rawContent = await readRawFile(path);
				const detected = detectFileType(path, rawContent);
				if (detected.unsupportedMessage) {
					return {
						content: "",
						filePath: path,
						startLine: 1,
						endLine: 0,
						totalLines: 0,
						isPartial: false,
						truncated: false,
						fileType: detected.fileType,
						unsupportedMessage: detected.unsupportedMessage,
					};
				}
				const normalized = normalizeLineEndings(rawContent);
				const lines = normalized.length === 0 ? [] : normalized.split("\n");
				const window = getReadWindow(lines, readOptions?.offset, readOptions?.limit);
				readSnapshots.set(path, {
					content: normalized,
					isPartial: window.isPartial,
					fileType: detected.fileType,
				});
				return {
					content: window.selected.join("\n"),
					filePath: path,
					startLine: window.startIndex + 1,
					endLine: window.startIndex + window.selected.length,
					totalLines: lines.length,
					isPartial: window.isPartial,
					truncated: window.truncated,
					fileType: detected.fileType,
				};
			},
			writeFile,
			editFile,
			writeNotebookCell,
			async glob(pattern, root, globOptions) {
				const result = await window.ipcRenderer.invoke("chat-tools:glob", {
					pattern,
					root,
					headLimit: globOptions?.headLimit,
					offset: globOptions?.offset,
					workspaceRoots,
				}) as { items?: string[]; truncated?: boolean };
				return {
					items: result.items ?? [],
					truncated: result.truncated === true,
				};
			},
			async grep(input) {
				const result = await window.ipcRenderer.invoke("chat-tools:grep", {
					...input,
					workspaceRoots,
				}) as {
					mode?: "content" | "files_with_matches" | "count";
					output?: string;
					files?: string[];
					truncated?: boolean;
					appliedLimit?: number;
					appliedOffset?: number;
					counts?: Array<{ path: string; count: number }>;
				};
				return {
					mode: result.mode ?? "files_with_matches",
					output: result.output ?? "",
					files: result.files ?? [],
					truncated: result.truncated === true,
					appliedLimit: result.appliedLimit,
					appliedOffset: result.appliedOffset,
					counts: result.counts ?? [],
				};
			},
			async runCommand(input) {
				const cwd = input.cwd ?? workspaceRoots[0] ?? "/";
				const result = await window.ipcRenderer.invoke("chat-tools:run-command", {
					...input,
					cwd,
				}) as {
					stdout?: string;
					stderr?: string;
					exitCode?: number | null;
					cwd?: string;
					status?: "completed" | "running";
					backgroundTaskId?: string;
					outputPath?: string;
				};
				return {
					stdout: result.stdout ?? "",
					stderr: result.stderr ?? "",
					exitCode: result.exitCode ?? null,
					cwd: result.cwd ?? cwd,
					status: result.status,
					backgroundTaskId: result.backgroundTaskId,
					outputPath: result.outputPath,
				};
			},
			async stopTask(taskId) {
				const result = await window.ipcRenderer.invoke("chat-tools:stop-task", {
					taskId,
				}) as { taskId?: string; command?: string };
				return {
					taskId: result.taskId ?? taskId,
					command: result.command,
					status: "stopped",
				};
			},
			async fetchUrl(input) {
				const response = await fetch(input.url, { signal: options.signal });
				if (!response.ok) {
					throw new Error(`Failed to fetch ${input.url}: ${response.status}`);
				}
				const contentType = response.headers.get("content-type") ?? "text/plain";
				const content = await response.text();
				const parser = typeof DOMParser === "undefined" ? undefined : new DOMParser();
				const readableContent =
					contentType.includes("text/html") && parser
						? (() => {
								const doc = parser.parseFromString(content, "text/html");
								doc.querySelectorAll("script,style,noscript").forEach((node) => node.remove());
								return normalizeLineEndings(doc.body?.textContent ?? doc.documentElement?.textContent ?? "");
							})()
						: normalizeLineEndings(content);
				const promptKeywords = (input.prompt ?? "")
					.toLowerCase()
					.split(/[^a-z0-9]+/i)
					.filter((token) => token.length >= 4)
					.slice(0, 8);
				const lines = readableContent
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean);
				const focusedLines =
					promptKeywords.length === 0
						? lines.slice(0, 80)
						: lines.filter((line) =>
								promptKeywords.some((keyword) => line.toLowerCase().includes(keyword)),
							).slice(0, 80);
				return {
					url: input.url,
					status: response.status,
					contentType,
					bytes: content.length,
					content: readableContent,
					result: (focusedLines.length > 0 ? focusedLines : lines.slice(0, 80)).join("\n"),
				};
			},
			searchWeb,
			async listContexts() {
				const result = await window.ipcRenderer.invoke("chat-tools:context-list", {
					workspaceRoots,
				}) as {
					items?: Array<{
						filename: string;
						title: string;
						description: string;
						path: string;
						updatedAt: number;
					}>;
				};
				return result.items ?? [];
			},
			async readContext(filename) {
				const result = await window.ipcRenderer.invoke("chat-tools:context-read", {
					filename,
					workspaceRoots,
				}) as {
					filename?: string;
					title?: string;
					description?: string;
					path?: string;
					content?: string;
				};
				return {
					filename: result.filename ?? filename,
					title: result.title ?? filename,
					description: result.description ?? "",
					path: result.path ?? filename,
					content: result.content ?? "",
				};
			},
			async writeContext(input) {
				const result = await window.ipcRenderer.invoke("chat-tools:context-write", {
					...input,
					workspaceRoots,
				}) as {
					filename?: string;
					title?: string;
					description?: string;
					path?: string;
					content?: string;
					action?: "created" | "updated";
				};
				return {
					filename: result.filename ?? input.filename,
					title: result.title ?? input.title ?? input.filename,
					description: result.description ?? input.description ?? "",
					path: result.path ?? input.filename,
					content: result.content ?? "",
					action: result.action ?? "updated",
				};
			},
			async listBlocks() {
				const result = await window.ipcRenderer.invoke("chat-tools:block-list", {
					workspaceRoots,
				}) as {
					items?: Array<{
						id: string;
						title: string;
						definition: string;
						schemaPath: string;
						diagramPath: string;
						contextPath: string;
						files: string[];
						updatedAt: number;
					}>;
				};
				return result.items ?? [];
			},
			async readBlock(blockId) {
				try {
					const result = await window.ipcRenderer.invoke("chat-tools:block-read", {
						blockId,
						workspaceRoots,
					}) as {
						id?: string;
						title?: string;
						definition?: string;
						schemaPath?: string;
						diagramPath?: string;
						contextPath?: string;
						files?: string[];
					};
					return {
						id: result.id ?? blockId,
						title: result.title ?? blockId,
						definition: result.definition ?? "",
						schemaPath: result.schemaPath ?? blockId,
						diagramPath: result.diagramPath ?? "",
						contextPath: result.contextPath ?? "",
						files: result.files ?? [],
					};
				} catch (error) {
					if (isMissingFileError(error)) {
						throw new Error(
							`Block not found: ${blockId}. Call Block with action "list" to inspect existing blocks, or Block with action "write" to create it.`,
						);
					}
					throw error;
				}
			},
			async writeBlock(input) {
				const result = await window.ipcRenderer.invoke("chat-tools:block-write", {
					...input,
					workspaceRoots,
				}) as {
					id?: string;
					title?: string;
					definition?: string;
					schemaPath?: string;
					diagramPath?: string;
					contextPath?: string;
					files?: string[];
					action?: "created" | "updated";
				};
				return {
					id: result.id ?? input.blockId,
					title: result.title ?? input.title ?? input.blockId,
					definition: result.definition ?? input.definition ?? "",
					schemaPath: result.schemaPath ?? input.blockId,
					diagramPath: result.diagramPath ?? "",
					contextPath: result.contextPath ?? "",
					files: result.files ?? input.files ?? [],
					action: result.action ?? "updated",
				};
			},
			listTools() {
				return getAvailableChatTools(context).map((tool) => ({
					name: tool.name,
					aliases: tool.aliases,
					description: tool.description,
					category: tool.category,
					inputSchema: tool.inputSchema,
				}));
			},
			getTodos() {
				return options.getTodos();
			},
			setTodos(items, merge) {
				return options.setTodos(items, merge);
			},
		};
		return context;
	})();
}
