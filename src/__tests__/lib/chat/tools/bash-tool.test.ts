import { describe, expect, it, vi } from "vitest";

import {
	DEFAULT_APPLICATION_SETTINGS,
	BASH_PERMITTED_COMMANDS_SETTING,
} from "@/lib/application-settings";
import { bashTool } from "@/lib/chat/tools/builtin/bash-tool";
import type { ChatToolContext } from "@/lib/chat/tools/tool-types";

function createContext(
	overrides: Partial<ChatToolContext> = {},
): ChatToolContext {
	return {
		sessionId: "session-1",
		modelId: "model-1",
		workspaceRoots: ["/workspace"],
		settings: DEFAULT_APPLICATION_SETTINGS,
		signal: new AbortController().signal,
		stopGeneration: vi.fn(),
		setMode: vi.fn(),
		readFile: vi.fn(),
		writeFile: vi.fn(),
		editFile: vi.fn(),
		writeNotebookCell: vi.fn(),
		glob: vi.fn(),
		grep: vi.fn(),
		runCommand: vi.fn(async () => ({
			stdout: "ok",
			stderr: "",
			exitCode: 0,
			cwd: "/workspace",
			status: "completed" as const,
		})),
		stopTask: vi.fn(),
		fetchUrl: vi.fn(),
		searchWeb: vi.fn(),
		listContexts: vi.fn(),
		readContext: vi.fn(),
		writeContext: vi.fn(),
		listBlocks: vi.fn(),
		readBlock: vi.fn(),
		writeBlock: vi.fn(),
		listTools: vi.fn(() => []),
		getTodos: vi.fn(() => []),
		setTodos: vi.fn(() => []),
		...overrides,
	};
}

describe("bashTool", () => {
	it("asks for approval before running mutating commands", async () => {
		const context = createContext();

		const result = await bashTool.execute(
			{
				command: "npm install",
				description: "Install dependencies",
			},
			context,
		);

		expect(result.pauseAfter).toBe(true);
		expect(result.display?.kind).toBe("question");
		expect(result.structuredContent).toMatchObject({
			type: "bash_permission_request",
			command: "npm install",
		});
		expect(context.runCommand).not.toHaveBeenCalled();
	});

	it("runs mutating commands that were already approved in settings", async () => {
		const context = createContext({
			settings: {
				...DEFAULT_APPLICATION_SETTINGS,
				[BASH_PERMITTED_COMMANDS_SETTING]: ["npm install"],
			},
		});

		const result = await bashTool.execute(
			{
				command: "npm install",
				description: "Install dependencies",
			},
			context,
		);

		expect(result.pauseAfter).toBeUndefined();
		expect(result.display?.kind).toBe("command");
		expect(context.runCommand).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "npm install",
				description: "Install dependencies",
			}),
		);
	});
});
