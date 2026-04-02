import { beforeEach, describe, expect, it } from "vitest";

import { ChatSessionStore } from "@/lib/chat/session-store";

describe("chat session store", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("persists session todos across store recreation", () => {
		const firstStore = new ChatSessionStore();
		const session = firstStore.createSession("Tasks", "model-1");
		firstStore.updateSessionTodos(
			session.id,
			[{ id: "todo-1", content: "Verify parity", status: "in_progress" }],
			true,
		);

		const secondStore = new ChatSessionStore();
		const restored = secondStore.getSnapshot(session.id);

		expect(restored?.todos).toEqual([
			{ id: "todo-1", content: "Verify parity", status: "in_progress" },
		]);
	});
});
