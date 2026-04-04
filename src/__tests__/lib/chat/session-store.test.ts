import { beforeEach, describe, expect, it, vi } from "vitest";

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

	it("sorts closed sessions with the latest first", () => {
		const nowSpy = vi.spyOn(Date, "now");
		nowSpy.mockReturnValueOnce(1000);
		const store = new ChatSessionStore();
		nowSpy.mockReturnValueOnce(1001);
		const first = store.createSession("First", "model-1");
		nowSpy.mockReturnValueOnce(1002);
		const second = store.createSession("Second", "model-1");

		nowSpy.mockReturnValueOnce(2000);
		store.closeSession(first.id);
		nowSpy.mockReturnValueOnce(3000);
		store.closeSession(second.id);

		expect(store.getClosedSnapshots().map((session) => session.id)).toEqual([
			second.id,
			first.id,
		]);
	});

	it("surfaces archived isolated sessions in history after they merge into storage", () => {
		const mainStore = new ChatSessionStore();
		const mainSession = mainStore.createSession("Main", "model-1");

		const isolatedStore = new ChatSessionStore();
		isolatedStore.setIsolated(true);
		const agentSession = isolatedStore.createSession("Archived Agent", "model-2", {
			windowKind: "agent",
			model: {
				id: "model-2",
				displayName: "Agent Model",
				provider: "openai",
			},
		});
		isolatedStore.archiveAndMerge(agentSession.id);

		expect(mainStore.getOpenSnapshots().map((session) => session.id)).toEqual([
			mainSession.id,
		]);
		expect(mainStore.getClosedSnapshots()).toEqual([
			expect.objectContaining({
				id: agentSession.id,
				windowKind: "agent",
				model: expect.objectContaining({
					id: "model-2",
					displayName: "Agent Model",
					provider: "openai",
				}),
			}),
		]);
	});

	it("can take a closed agent session out of history before reopening it", () => {
		const isolatedStore = new ChatSessionStore();
		isolatedStore.setIsolated(true);
		const agentSession = isolatedStore.createSession("Archived Agent", "model-2", {
			windowKind: "agent",
			model: {
				id: "model-2",
				displayName: "Agent Model",
				provider: "openai",
			},
		});
		isolatedStore.archiveAndMerge(agentSession.id);

		const mainStore = new ChatSessionStore();
		const taken = mainStore.takeClosedSession(agentSession.id);

		expect(taken).toEqual(
			expect.objectContaining({
				id: agentSession.id,
				windowKind: "agent",
				model: expect.objectContaining({
					id: "model-2",
					displayName: "Agent Model",
					provider: "openai",
				}),
			}),
		);
		expect(mainStore.getClosedSnapshots()).toEqual([]);
	});
});
