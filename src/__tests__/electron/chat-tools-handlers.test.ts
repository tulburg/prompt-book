import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseBlockSchema } from "@/lib/chat/tools/block-format";

const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const execFileMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
	ipcMain: {
		handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
			registeredHandlers.set(channel, handler);
		}),
	},
}));

vi.mock("node:child_process", () => ({
	execFile: execFileMock,
	spawn: spawnMock,
	default: {
		execFile: execFileMock,
		spawn: spawnMock,
	},
}));

vi.mock("node:fs", () => ({
	mkdirSync: vi.fn(),
	createWriteStream: vi.fn(() => ({
		write: vi.fn(),
		end: vi.fn(),
		on: vi.fn(),
	})),
	promises: {
		mkdir: mkdirMock,
		readFile: readFileMock,
		writeFile: writeFileMock,
	},
	default: {
		mkdirSync: vi.fn(),
		createWriteStream: vi.fn(() => ({
			write: vi.fn(),
			end: vi.fn(),
			on: vi.fn(),
		})),
		promises: {
			mkdir: mkdirMock,
			readFile: readFileMock,
			writeFile: writeFileMock,
		},
	},
}));

import { registerChatToolHandlers } from "../../../electron/handlers/chat-tools-handlers";

function getHandler(name: string) {
	const handler = registeredHandlers.get(name);
	if (!handler) {
		throw new Error(`Missing handler: ${name}`);
	}
	return handler;
}

function createMockChild(output: string) {
	const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
	stdout.setEncoding = () => {};
	const stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
	stderr.setEncoding = () => {};

	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter & { setEncoding: (encoding: string) => void };
		stderr: EventEmitter & { setEncoding: (encoding: string) => void };
		kill: () => void;
	};
	child.stdout = stdout;
	child.stderr = stderr;
	child.kill = vi.fn();

	queueMicrotask(() => {
		stdout.emit("data", output);
		child.emit("close", 0, null);
	});

	return child;
}

describe("chat tool handlers path resolution", () => {
	beforeEach(() => {
		registeredHandlers.clear();
		vi.clearAllMocks();
		registerChatToolHandlers();
	});

	it("anchors grep relative paths to the open workspace root", async () => {
		execFileMock.mockImplementation(
			(
				_command: string,
				_args: string[],
				_options: { cwd?: string; timeout?: number; shell?: boolean },
				callback: (error: Error | null, stdout: string, stderr: string) => void,
			) => {
				callback(null, "demo.ts\n", "");
			},
		);

		const result = await getHandler("chat-tools:grep")(null, {
			pattern: "needle",
			path: "src",
			output_mode: "files_with_matches",
			workspaceRoots: ["/user/project"],
		}) as { files: string[] };

		const [, args] = execFileMock.mock.calls[0] as [string, string[]];
		expect(args.at(-1)).toBe("/user/project/src");
		expect(result.files).toEqual(["/user/project/src/demo.ts"]);
	});

	it("anchors glob relative roots to the open workspace root", async () => {
		spawnMock.mockImplementation(() => createMockChild("feature.ts\n"));

		const result = await getHandler("chat-tools:glob")(null, {
			pattern: "*.ts",
			root: ".",
			workspaceRoots: ["/user/project"],
		}) as { items: string[] };

		const [, args] = spawnMock.mock.calls[0] as [string, string[]];
		expect(args).toEqual(["--files", "/user/project", "--glob", "**/*.ts"]);
		expect(result.items).toEqual(["/user/project/feature.ts"]);
	});

	it("anchors block file paths to the open workspace root", async () => {
		readFileMock.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
		mkdirMock.mockResolvedValue(undefined);
		writeFileMock.mockResolvedValue(undefined);

		const result = await getHandler("chat-tools:block-write")(null, {
			blockId: "core",
			title: "Core",
			definition: "Core flow",
			files: ["src/index.ts", "/external/keep.ts"],
			diagramContent: "flowchart TD\n    A[Start]",
			workspaceRoots: ["/user/project"],
		}) as { files: string[] };

		const schemaContent = writeFileMock.mock.calls[1]?.[1];
		const parsed = parseBlockSchema(
			"core",
			"/user/project/.odex/blocks/core/block.json",
			String(schemaContent),
		);

		expect(result.files).toEqual(["/external/keep.ts", "/user/project/src/index.ts"]);
		expect(parsed.files).toEqual(["/external/keep.ts", "/user/project/src/index.ts"]);
	});

	it("anchors run-command relative cwd values to the open workspace root", async () => {
		execFileMock.mockImplementation(
			(
				_command: string,
				_args: string[],
				_options: { cwd?: string; timeout?: number; shell?: boolean },
				callback: (error: Error | null, stdout: string, stderr: string) => void,
			) => {
				callback(null, "", "");
			},
		);

		await getHandler("chat-tools:run-command")(null, {
			command: "pwd",
			cwd: "src",
			workspaceRoots: ["/user/project"],
		});

		const [, , options] = execFileMock.mock.calls[0] as [
			string,
			string[],
			{ cwd?: string; timeout?: number; shell?: boolean },
		];
		expect(options.cwd).toBe("/user/project/src");
	});

	it("maps Claude-style /workspace aliases to the open workspace root", async () => {
		execFileMock.mockImplementation(
			(
				_command: string,
				_args: string[],
				_options: { cwd?: string; timeout?: number; shell?: boolean },
				callback: (error: Error | null, stdout: string, stderr: string) => void,
			) => {
				callback(null, "demo.ts\n", "");
			},
		);

		const result = await getHandler("chat-tools:grep")(null, {
			pattern: "needle",
			path: "/workspace/src",
			output_mode: "files_with_matches",
			workspaceRoots: ["/user/project"],
		}) as { files: string[] };

		const [, args] = execFileMock.mock.calls[0] as [string, string[]];
		expect(args.at(-1)).toBe("/user/project/src");
		expect(result.files).toEqual(["/user/project/src/demo.ts"]);
	});
});
