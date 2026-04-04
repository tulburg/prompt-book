import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	parseContextMarkdown,
	serializeContextMarkdown,
} from "@/lib/chat/tools/context-format";
import { createToolContext } from "@/lib/chat/tools/tool-runtime";

type FileMap = Map<string, string>;

function createProjectBridge(files: FileMap) {
	return {
		restoreLastProject: vi.fn(async () => ({
			roots: [{ path: "/workspace" }],
		})),
		readFile: vi.fn(async (filePath: string) => {
			const content = files.get(filePath);
			if (content === undefined) {
				throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
			}
			return {
				content,
				permissions: { read: true, write: true, status: "granted" as const },
			};
		}),
		writeFile: vi.fn(async (filePath: string, content: string) => {
			files.set(filePath, content);
			return {
				permissions: { read: true, write: true, status: "granted" as const },
			};
		}),
		createFile: vi.fn(async (parentPath: string, name: string, content = "") => {
			const nextPath = `${parentPath}/${name}`.replace("//", "/");
			files.set(nextPath, content);
			return {
				parentPath,
				node: { path: nextPath, name, kind: "file" as const },
			};
		}),
	};
}

function installWindowStubs(files: FileMap) {
	Object.defineProperty(window, "projectBridge", {
		configurable: true,
		value: createProjectBridge(files),
	});
	Object.defineProperty(window, "ipcRenderer", {
		configurable: true,
		value: {
			invoke: vi.fn(async (channel: string, payload?: Record<string, unknown>) => {
				if (channel === "chat-tools:stop-task") {
					return { taskId: payload?.taskId, command: "sleep 10" };
				}
				if (channel === "chat-tools:grep") {
					return { mode: "files_with_matches", output: "", files: [], truncated: false, counts: [] };
				}
				if (channel === "chat-tools:glob") {
					return { items: [], truncated: false };
				}
				if (channel === "chat-tools:context-list") {
					const items = [...files.entries()]
						.filter(([filePath]) => filePath.startsWith("/workspace/.odex/context/"))
						.map(([filePath, content]) => {
							const filename = filePath.split("/").pop() ?? "unknown.md";
							const parsed = parseContextMarkdown(filename, content);
							return {
								filename,
								title: parsed.title,
								description: parsed.description,
								path: filePath,
								updatedAt: 1,
							};
						});
					return { items };
				}
				if (channel === "chat-tools:context-read") {
					const filename = String(payload?.filename ?? "");
					const filePath = `/workspace/.odex/context/${filename}`;
					const content = files.get(filePath);
					if (content === undefined) {
						throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
					}
					const parsed = parseContextMarkdown(filename, content);
					return {
						filename,
						title: parsed.title,
						description: parsed.description,
						path: filePath,
						content,
					};
				}
				if (channel === "chat-tools:context-write") {
					const filename = String(payload?.filename ?? "");
					const title = typeof payload?.title === "string" && payload.title.trim()
						? payload.title.trim()
						: undefined;
					const description =
						typeof payload?.description === "string" && payload.description.trim()
							? payload.description.trim()
							: undefined;
					const paragraph = String(payload?.paragraph ?? "").trim();
					const filePath = `/workspace/.odex/context/${filename}`;
					const existing = files.get(filePath);
					const parsed = existing ? parseContextMarkdown(filename, existing) : null;
					const nextTitle = title ?? parsed?.title;
					const nextDescription = description ?? parsed?.description;
					if (!nextTitle || !nextDescription || !paragraph) {
						throw new Error("Missing context metadata.");
					}
					const content = serializeContextMarkdown({
						title: nextTitle,
						description: nextDescription,
						paragraphs: [...(parsed?.paragraphs ?? []), `[2026-04-04T00:00:00.000Z] ${paragraph}`],
					});
					files.set(filePath, content);
					return {
						filename,
						title: nextTitle,
						description: nextDescription,
						path: filePath,
						content,
						action: existing ? "updated" : "created",
					};
				}
				if (channel === "chat-tools:run-command") {
					return { stdout: "", stderr: "", exitCode: 0, cwd: "/workspace", status: "completed" };
				}
				throw new Error(`Unexpected IPC channel: ${channel}`);
			}),
		},
	});
}

async function makeContext(files: FileMap) {
	installWindowStubs(files);
	return createToolContext({
		sessionId: "session-1",
		modelId: "model-1",
		signal: new AbortController().signal,
		stopGeneration: () => {},
		setMode: () => {},
		getTodos: () => [],
		setTodos: (items) => items,
	});
}

describe("tool runtime", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("allows reading files outside the workspace roots", async () => {
		const files = new Map<string, string>([["/external/file.txt", "outside workspace"]]);
		const context = await makeContext(files);

		const result = await context.readFile("/external/file.txt");

		expect(result.content).toBe("outside workspace");
		expect(result.filePath).toBe("/external/file.txt");
	});

	it("rejects overwriting a file that changed after it was read", async () => {
		const files = new Map<string, string>([["/workspace/file.txt", "original"]]);
		const context = await makeContext(files);

		await context.readFile("/workspace/file.txt");
		files.set("/workspace/file.txt", "changed elsewhere");

		await expect(context.writeFile("/workspace/file.txt", "replacement")).rejects.toThrow(
			"File has changed since it was read.",
		);
	});

	it("rejects editing after a partial read", async () => {
		const files = new Map<string, string>([
			["/workspace/file.txt", "line 1\nline 2\nline 3"],
		]);
		const context = await makeContext(files);

		await context.readFile("/workspace/file.txt", { limit: 1 });

		await expect(
			context.editFile("/workspace/file.txt", "line 2", "updated line 2"),
		).rejects.toThrow("File has not been read fully yet.");
	});

	it("supports inserting and deleting notebook cells by id", async () => {
		const files = new Map<string, string>([
			[
				"/workspace/notebook.ipynb",
				JSON.stringify(
					{
						cells: [
							{ id: "cell-1", cell_type: "code", source: ["print('hi')\n"], metadata: {} },
						],
					},
					null,
					2,
				),
			],
		]);
		const context = await makeContext(files);

		await context.readFile("/workspace/notebook.ipynb");
		const inserted = await context.writeNotebookCell({
			notebookPath: "/workspace/notebook.ipynb",
			cellId: "cell-1",
			newSource: "Hello notebook",
			cellType: "markdown",
			editMode: "insert",
		});

		expect(inserted.editMode).toBe("insert");
		expect(inserted.editedCellId).toBeTruthy();
		expect(files.get("/workspace/notebook.ipynb")).toContain("Hello notebook");

		await context.readFile("/workspace/notebook.ipynb");
		const deleted = await context.writeNotebookCell({
			notebookPath: "/workspace/notebook.ipynb",
			cellId: inserted.editedCellId,
			newSource: "",
			editMode: "delete",
		});

		expect(deleted.editMode).toBe("delete");
		expect(files.get("/workspace/notebook.ipynb")).not.toContain("Hello notebook");
	});

	it("lists, reads, and writes stored context files", async () => {
		const files = new Map<string, string>([
			[
				"/workspace/.odex/context/codebase.md",
				serializeContextMarkdown({
					title: "Codebase",
					description: "Current codebase structure and conventions.",
					paragraphs: ["[2026-04-03T00:00:00.000Z] Initial context."],
				}),
			],
		]);
		const context = await makeContext(files);

		const listed = await context.listContexts();
		expect(listed).toHaveLength(1);
		expect(listed[0]?.filename).toBe("codebase.md");
		expect(listed[0]?.title).toBe("Codebase");

		const read = await context.readContext("codebase.md");
		expect(read.description).toBe("Current codebase structure and conventions.");
		expect(read.content).toContain("## Context Log");

		const written = await context.writeContext({
			filename: "codebase.md",
			description: "Current codebase structure, conventions, and recent context-tool changes.",
			paragraph: "Added a persistent Context tool backed by .odex/context.",
		});
		expect(written.action).toBe("updated");
		expect(written.description).toContain("context-tool changes");
		expect(files.get("/workspace/.odex/context/codebase.md")).toContain(
			"Added a persistent Context tool backed by .odex/context.",
		);
	});
});
