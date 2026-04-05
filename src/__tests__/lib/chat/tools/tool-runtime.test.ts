import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	parseBlockSchema,
	serializeBlockSchema,
} from "@/lib/chat/tools/block-format";
import {
	parseContextMarkdown,
	serializeContextMarkdown,
} from "@/lib/chat/tools/context-format";
import { createToolContext } from "@/lib/chat/tools/tool-runtime";

type FileMap = Map<string, string>;

function createProjectBridge(files: FileMap, rootPath = "/workspace") {
	return {
		restoreLastProject: vi.fn(async () => ({
			roots: [{ path: rootPath }],
		})),
		listDirectory: vi.fn(async (directoryPath: string) => {
			const normalizedPath = directoryPath.replace(/\/+$/, "") || "/";
			const prefix = normalizedPath === "/" ? "/" : `${normalizedPath}/`;
			const childNames = new Set<string>();
			for (const filePath of files.keys()) {
				if (!filePath.startsWith(prefix)) {
					continue;
				}
				const remainder = filePath.slice(prefix.length);
				const childName = remainder.split("/")[0]?.trim();
				if (childName) {
					childNames.add(childName);
				}
			}
			if (childNames.size === 0) {
				throw new Error(`ENOENT: no such file or directory, scandir '${directoryPath}'`);
			}
			return {
				path: normalizedPath,
				children: [...childNames].map((name) => ({
					path: `${prefix}${name}`.replace("//", "/"),
					name,
					kind: "directory" as const,
					parentPath: normalizedPath,
					rootPath,
					permissions: { read: true, write: true, status: "granted" as const },
				})),
				permissions: { read: true, write: true, status: "granted" as const },
			};
		}),
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

function installWindowStubs(files: FileMap, rootPath = "/workspace") {
	Object.defineProperty(window, "projectBridge", {
		configurable: true,
		value: createProjectBridge(files, rootPath),
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
					const contentBody = String(payload?.contentBody ?? "").trim();
					const filePath = `/workspace/.odex/context/${filename}`;
					const existing = files.get(filePath);
					const parsed = existing ? parseContextMarkdown(filename, existing) : null;
					const nextTitle = title ?? parsed?.title;
					const nextDescription = description ?? parsed?.description;
					if (!nextTitle || !nextDescription || !contentBody) {
						throw new Error("Missing context metadata.");
					}
					const pointers = contentBody
						.split(/\n{2,}/)
						.map((entry: string) => entry.trim())
						.filter(Boolean);
					const content = serializeContextMarkdown({
						title: nextTitle,
						description: nextDescription,
						pointers,
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
				if (channel === "chat-tools:block-list") {
					const items = [...files.entries()]
						.filter(([filePath]) => filePath.endsWith("/block.json"))
						.map(([filePath, content]) => {
							const blockId = filePath.split("/").slice(-2, -1)[0] ?? "unknown";
							const parsed = parseBlockSchema(blockId, filePath, content);
							return {
								id: parsed.id,
								title: parsed.title,
								definition: parsed.definition,
								schemaPath: parsed.schemaPath,
								diagramPath: parsed.diagramPath,
								contextPath: parsed.contextPath,
								files: parsed.files,
								updatedAt: 1,
							};
						});
					return { items };
				}
				if (channel === "chat-tools:block-read") {
					const blockId = String(payload?.blockId ?? "");
					const filePath = `/workspace/.odex/blocks/${blockId}/block.json`;
					const content = files.get(filePath);
					if (content === undefined) {
						throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
					}
					return parseBlockSchema(blockId, filePath, content);
				}
				if (channel === "chat-tools:block-write") {
					const blockId = String(payload?.blockId ?? "");
					const blockDir = `/workspace/.odex/blocks/${blockId}`;
					const schemaPath = `${blockDir}/block.json`;
					const existing = files.get(schemaPath);
					const parsed = existing ? parseBlockSchema(blockId, schemaPath, existing) : null;
					const title = typeof payload?.title === "string" && payload.title.trim()
						? payload.title.trim()
						: parsed?.title ?? "";
					const definition = typeof payload?.definition === "string" && payload.definition.trim()
						? payload.definition.trim()
						: parsed?.definition ?? "";
					const blockFiles = Array.isArray(payload?.files)
						? payload.files.filter((value): value is string => typeof value === "string")
						: parsed?.files ?? [];
					const diagramPath = `${blockDir}/${typeof payload?.diagramFilename === "string" && payload.diagramFilename.trim() ? payload.diagramFilename.trim() : "diagram.mmd"}`;
					const contextFilename =
						typeof payload?.contextFilename === "string" && payload.contextFilename.trim()
							? payload.contextFilename.trim()
							: `${blockId}.md`;
					const contextPath = `/workspace/.odex/context/${contextFilename}`;
					if (!title || !definition) {
						throw new Error("Missing block metadata.");
					}
					files.set(
						diagramPath,
						String(payload?.diagramContent ?? "flowchart TD\n    Block[\"Chat Tools\"]\n").trimEnd() + "\n",
					);
					files.set(
						schemaPath,
						serializeBlockSchema({
							title,
							definition,
							files: blockFiles,
							diagramPath,
							contextPath,
						}),
					);
					return {
						id: blockId,
						title,
						definition,
						schemaPath,
						diagramPath,
						contextPath,
						files: blockFiles,
						action: existing ? "updated" : "created",
					};
				}
				if (channel === "chat-tools:run-command") {
					return {
						stdout: "",
						stderr: "",
						exitCode: 0,
						cwd: typeof payload?.cwd === "string" ? payload.cwd : "/unexpected",
						status: "completed",
					};
				}
				throw new Error(`Unexpected IPC channel: ${channel}`);
			}),
		},
	});
}

async function makeContext(files: FileMap, rootPath = "/workspace") {
	installWindowStubs(files, rootPath);
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

	it("maps Claude-style /workspace paths to the restored project root", async () => {
		const files = new Map<string, string>([
			["/Users/demo/project/frontend/src/consumer/pages/login-page.tsx", "export const LoginPage = () => null;\n"],
		]);
		const context = await makeContext(files, "/Users/demo/project");

		const result = await context.readFile("/workspace/frontend/src/consumer/pages/login-page.tsx");

		expect(result.filePath).toBe("/Users/demo/project/frontend/src/consumer/pages/login-page.tsx");
		expect(result.content).toContain("LoginPage");
	});

	it("allows overwriting an existing file without a prior full read", async () => {
		const files = new Map<string, string>([["/workspace/file.txt", "original"]]);
		const context = await makeContext(files);

		const result = await context.writeFile("/workspace/file.txt", "replacement");

		expect(result.action).toBe("overwritten");
		expect(result.originalContent).toBe("original");
		expect(files.get("/workspace/file.txt")).toBe("replacement");
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

	it("defaults shell commands to the restored project root", async () => {
		const files = new Map<string, string>();
		const context = await makeContext(files);

		const result = await context.runCommand({
			command: "ls",
			description: "List files",
		});

		expect(result.cwd).toBe("/workspace");
	});

	it("forwards workspace roots when running shell commands with a relative cwd", async () => {
		const files = new Map<string, string>();
		const context = await makeContext(files);

		await context.runCommand({
			command: "ls",
			cwd: "src",
			description: "List source files",
		});

		const invokeMock = window.ipcRenderer.invoke as ReturnType<typeof vi.fn>;
		expect(invokeMock).toHaveBeenCalledWith(
			"chat-tools:run-command",
			expect.objectContaining({
				cwd: "src",
				workspaceRoots: ["/workspace"],
			}),
		);
	});

	it("returns a friendly error when a block does not exist", async () => {
		const files = new Map<string, string>();
		const context = await makeContext(files);

		await expect(context.readBlock("backend-api")).rejects.toThrow(
			'Block not found: backend-api. Call Block with action "list" to inspect existing blocks, or Block with action "write" to create it.',
		);
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
					pointers: ["Entry point at src/main.ts, bootstraps the Electron app."],
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
		expect(read.content).toContain("## Context Map");

		const written = await context.writeContext({
			filename: "codebase.md",
			description: "Current codebase structure, conventions, and recent context-tool changes.",
			contentBody: "Entry point at src/main.ts, bootstraps the Electron app.\n\nContext tool backed by .odex/context provides persistent project pointers.",
		});
		expect(written.action).toBe("updated");
		expect(written.description).toContain("context-tool changes");
		expect(files.get("/workspace/.odex/context/codebase.md")).toContain(
			"Context tool backed by .odex/context provides persistent project pointers.",
		);
	});

	it("marks the tool context as Odex-managed when .odex exists", async () => {
		const files = new Map<string, string>([
			[
				"/workspace/.odex/context/codebase.md",
				serializeContextMarkdown({
					title: "Codebase",
					description: "Project overview.",
					pointers: ["Bootstrapped context for project."],
				}),
			],
		]);

		const context = await makeContext(files);

		expect(context.odex).toEqual({
			isManagedProject: true,
			rootPaths: ["/workspace"],
		});
	});

	it("lists, reads, and writes stored blocks while leaving context writes explicit", async () => {
		const files = new Map<string, string>([
			[
				"/workspace/.odex/blocks/chat-tools/block.json",
				serializeBlockSchema({
					title: "Chat Tools",
					definition: "The chat tool runtime and instruction layer.",
					files: ["/workspace/src/lib/chat/tools/tool-registry.ts"],
					diagramPath: "/workspace/.odex/blocks/chat-tools/diagram.mmd",
					contextPath: "/workspace/.odex/context/chat-tools.md",
				}),
			],
			[
				"/workspace/.odex/blocks/chat-tools/diagram.mmd",
				'flowchart TD\n    Block["Chat Tools"]\n',
			],
			[
				"/workspace/.odex/context/chat-tools.md",
				serializeContextMarkdown({
					title: "Chat Tools Context",
					description: "Context for the chat tools block.",
					pointers: ["Tool registry at src/lib/chat/tools/tool-registry.ts manages available tools."],
				}),
			],
		]);
		const context = await makeContext(files);

		const listed = await context.listBlocks();
		expect(listed).toHaveLength(1);
		expect(listed[0]?.id).toBe("chat-tools");
		expect(listed[0]?.files).toContain("/workspace/src/lib/chat/tools/tool-registry.ts");

		const read = await context.readBlock("chat-tools");
		expect(read.title).toBe("Chat Tools");
		expect(read.diagramPath).toBe("/workspace/.odex/blocks/chat-tools/diagram.mmd");

		await context.writeContext({
			filename: "chat-tools.md",
			description: "Context for the chat tools block.",
			contentBody: "Tool registry at src/lib/chat/tools/tool-registry.ts manages available tools.\n\nBlock persistence and block-level model instructions handled by block-tool.ts.",
		});

		const written = await context.writeBlock({
			blockId: "chat-tools",
			definition: "The chat tool runtime, context tool, and block tool layer.",
			files: [
				"/workspace/src/lib/chat/tools/tool-registry.ts",
				"/workspace/src/lib/chat/tools/builtin/block-tool.ts",
			],
			diagramContent: 'flowchart TD\n    Block["Chat Tools"]\n    Runtime["Tool Runtime"]\n    Block --> Runtime',
		});
		expect(written.action).toBe("updated");
		expect(written.files).toContain("/workspace/src/lib/chat/tools/builtin/block-tool.ts");
		expect(files.get("/workspace/.odex/context/chat-tools.md")).toContain(
			"Block persistence and block-level model instructions handled by block-tool.ts.",
		);
		expect(files.get("/workspace/.odex/blocks/chat-tools/diagram.mmd")).toContain("Tool Runtime");
	});

	it("creates a new block that links to a separately written context", async () => {
		const files = new Map<string, string>();
		const context = await makeContext(files);

		await context.writeContext({
			filename: "app-frontend-ui.md",
			title: "Frontend UI",
			description: "Renderer UI built with React and Vite.",
			contentBody: "Entry point at src/main.tsx renders the React app.\n\nApp shell at src/app.tsx provides layout and routing.",
		});

		const written = await context.writeBlock({
			blockId: "app-frontend-ui",
			title: "Frontend UI",
			definition: "Renderer UI built with React and Vite.",
			files: [
				"/workspace/src/main.tsx",
				"/workspace/src/app.tsx",
			],
		});

		expect(written.action).toBe("created");
		expect(written.schemaPath).toBe("/workspace/.odex/blocks/app-frontend-ui/block.json");
		expect(written.contextPath).toBe("/workspace/.odex/context/app-frontend-ui.md");
		expect(files.get("/workspace/.odex/blocks/app-frontend-ui/block.json")).toContain("Frontend UI");
		expect(files.get("/workspace/.odex/blocks/app-frontend-ui/diagram.mmd")).toContain("flowchart TD");
		expect(files.get("/workspace/.odex/context/app-frontend-ui.md")).toContain(
			"App shell at src/app.tsx provides layout and routing.",
		);
	});

	it("does not create a context file as a side effect of block writes", async () => {
		const files = new Map<string, string>();
		const context = await makeContext(files);

		await context.writeBlock({
			blockId: "backend-api",
			title: "Backend API",
			definition: "Express server handling API routes.",
			files: ["/workspace/src/server.ts"],
		});

		expect(files.has("/workspace/.odex/blocks/backend-api/block.json")).toBe(true);
		expect(files.has("/workspace/.odex/context/backend-api.md")).toBe(false);
	});
});
