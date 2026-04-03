import { beforeEach, describe, expect, it } from "vitest";

import { ChatSessionStore } from "@/lib/chat/session-store";

describe("chat session store", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("archives a closed session while keeping it in history", () => {
		const store = new ChatSessionStore();
		const first = store.createSession("First", "model-1");
		const second = store.createSession("Second", "model-1");
		const third = store.createSession("Third", "model-1");

		store.setActiveSession(second.id);
		const nextActive = store.closeSession(second.id);

		expect(store.getOpenSnapshots().map((session) => session.id)).toEqual([
			first.id,
			third.id,
		]);
		expect(store.getClosedSnapshots().map((session) => session.id)).toEqual([
			second.id,
		]);
		expect(store.getSnapshot(second.id)?.closedAt).not.toBeNull();
		expect(nextActive?.id).toBe(third.id);
		expect(store.getActiveSnapshot()?.id).toBe(third.id);
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
