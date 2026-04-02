import type {
	ChatMessage,
	ChatMode,
	ChatSession,
	ChatSessionState,
	ChatTranscriptEntry,
} from "./types";

const STORAGE_KEY = "prompt-book.chat-session-store.v1";

type PersistedChatState = {
	sessions: ChatSessionState[];
	activeSessionId: string | null;
	defaultMode: ChatMode;
};

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createBootstrapEntry(mode: ChatMode): ChatTranscriptEntry {
	return {
		id: generateId(),
		role: "system",
		content: `Session bootstrapped in ${mode} mode.`,
		timestamp: Date.now(),
		visibility: "hidden",
		includeInHistory: false,
		isMeta: true,
		subtype: "bootstrap",
	};
}

function deriveMessages(transcript: ChatTranscriptEntry[]): ChatMessage[] {
	return transcript
		.filter((entry) => entry.visibility === "visible")
		.map((entry) => ({
			id: entry.id,
			role: entry.role,
			content: entry.content,
			timestamp: entry.timestamp,
			isStreaming: entry.isStreaming,
			subtype: entry.subtype,
			toolInvocation: entry.toolInvocation,
			toolResult: entry.toolResult,
		}));
}

function toSnapshot(session: ChatSessionState): ChatSession {
	return {
		...session,
		todos: session.todos.map((item) => ({ ...item })),
		transcript: session.transcript.map((entry) => ({ ...entry })),
		messages: deriveMessages(session.transcript),
	};
}

function deriveTitleFromContent(content: string): string {
	const normalized = content.trim().replace(/\s+/g, " ");
	if (!normalized) return "New Chat";
	return normalized.length > 40 ? `${normalized.slice(0, 37)}...` : normalized;
}

export class ChatSessionStore {
	private sessions: ChatSessionState[] = [];
	private activeSessionId: string | null = null;
	private defaultMode: ChatMode = "Agent";

	private findNearestOpenSession(startIndex: number): ChatSessionState | null {
		for (let index = startIndex; index < this.sessions.length; index++) {
			if (this.sessions[index]?.closedAt == null) {
				return this.sessions[index] ?? null;
			}
		}
		for (let index = startIndex - 1; index >= 0; index--) {
			if (this.sessions[index]?.closedAt == null) {
				return this.sessions[index] ?? null;
			}
		}
		return null;
	}

	constructor() {
		this.restore();
	}

	private getStorage(): Storage | undefined {
		try {
			return typeof window !== "undefined" ? window.localStorage : undefined;
		} catch {
			return undefined;
		}
	}

	private persist(): void {
		const storage = this.getStorage();
		if (!storage) return;
		const payload: PersistedChatState = {
			sessions: this.sessions,
			activeSessionId: this.activeSessionId,
			defaultMode: this.defaultMode,
		};
		try {
			storage.setItem(STORAGE_KEY, JSON.stringify(payload));
		} catch {
			// Ignore storage failures and keep the in-memory session usable.
		}
	}

	private restore(): void {
		const storage = this.getStorage();
		if (!storage) return;
		try {
			const raw = storage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<PersistedChatState>;
			this.sessions = Array.isArray(parsed.sessions)
				? parsed.sessions.map((session) => ({
						...session,
						closedAt:
							typeof session.closedAt === "number" ? session.closedAt : null,
						todos: Array.isArray(session.todos) ? session.todos : [],
						transcript: Array.isArray(session.transcript) ? session.transcript : [],
					}))
				: [];
			this.activeSessionId =
				typeof parsed.activeSessionId === "string" || parsed.activeSessionId === null
					? parsed.activeSessionId
					: null;
			this.defaultMode =
				parsed.defaultMode === "Ask" || parsed.defaultMode === "Edit"
					? parsed.defaultMode
					: "Agent";
		} catch {
			this.sessions = [];
			this.activeSessionId = null;
			this.defaultMode = "Agent";
		}
	}

	getSnapshots(): ChatSession[] {
		return this.sessions.map(toSnapshot);
	}

	getOpenSnapshots(): ChatSession[] {
		return this.sessions
			.filter((session) => session.closedAt == null)
			.map(toSnapshot);
	}

	getClosedSnapshots(): ChatSession[] {
		return this.sessions
			.filter((session) => session.closedAt != null)
			.map(toSnapshot);
	}

	getActiveSnapshot(): ChatSession | null {
		const session = this.sessions.find(
			(candidate) =>
				candidate.id === this.activeSessionId && candidate.closedAt == null,
		);
		return session ? toSnapshot(session) : null;
	}

	getSnapshot(sessionId: string): ChatSession | null {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		return session ? toSnapshot(session) : null;
	}

	getDefaultMode(): ChatMode {
		return this.defaultMode;
	}

	setDefaultMode(mode: ChatMode): void {
		this.defaultMode = mode;
		this.persist();
	}

	ensureSession(modelId: string | null): ChatSession {
		return this.getActiveSnapshot() ?? this.createSession("New Chat", modelId);
	}

	createSession(title = "New Chat", modelId: string | null = null): ChatSession {
		const mode = this.defaultMode;
		const session: ChatSessionState = {
			id: generateId(),
			title,
			mode,
			modelId,
			createdAt: Date.now(),
			bootstrappedAt: Date.now(),
			closedAt: null,
			todos: [],
			transcript: [createBootstrapEntry(mode)],
		};
		this.sessions.push(session);
		this.activeSessionId = session.id;
		this.persist();
		return toSnapshot(session);
	}

	closeSession(sessionId: string): ChatSession | null {
		const index = this.sessions.findIndex((candidate) => candidate.id === sessionId);
		if (index === -1) return this.getActiveSnapshot();

		const session = this.sessions[index];
		if (!session || session.closedAt != null) {
			return this.getActiveSnapshot();
		}
		session.closedAt = Date.now();
		if (this.activeSessionId === sessionId) {
			const fallback = this.findNearestOpenSession(index);
			this.activeSessionId = fallback?.id ?? null;
		}
		this.persist();
		return this.getActiveSnapshot();
	}

	setActiveSession(sessionId: string): ChatSession | null {
		const exists = this.sessions.some(
			(session) => session.id === sessionId && session.closedAt == null,
		);
		if (!exists) return null;
		this.activeSessionId = sessionId;
		this.persist();
		return this.getActiveSnapshot();
	}

	setSessionMode(sessionId: string, mode: ChatMode): ChatSession | null {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		if (!session) return null;
		session.mode = mode;
		this.defaultMode = mode;
		this.persist();
		return toSnapshot(session);
	}

	setSessionModel(sessionId: string, modelId: string | null): ChatSession | null {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		if (!session) return null;
		session.modelId = modelId;
		this.persist();
		return toSnapshot(session);
	}

	appendEntry(sessionId: string, entry: ChatTranscriptEntry): ChatSession | null {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		if (!session) return null;
		session.transcript.push(entry);
		if (session.title === "New Chat" && entry.role === "user" && entry.visibility === "visible") {
			session.title = deriveTitleFromContent(entry.content);
		}
		this.persist();
		return toSnapshot(session);
	}

	updateEntry(
		sessionId: string,
		entryId: string,
		updater: (entry: ChatTranscriptEntry) => ChatTranscriptEntry,
	): ChatSession | null {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		if (!session) return null;
		const index = session.transcript.findIndex((entry) => entry.id === entryId);
		if (index === -1) return null;
		session.transcript[index] = updater(session.transcript[index]!);
		this.persist();
		return toSnapshot(session);
	}

	getSessionTodos(sessionId: string) {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		return session?.todos.map((item) => ({ ...item })) ?? [];
	}

	updateSessionTodos(
		sessionId: string,
		items: Array<{
			id: string;
			content: string;
			status: "pending" | "in_progress" | "completed" | "cancelled";
		}>,
		merge: boolean,
	) {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		if (!session) {
			return [];
		}
		const current = session.todos ?? [];
		const next = merge
			? (() => {
					const byId = new Map(current.map((item) => [item.id, item]));
					for (const item of items) {
						byId.set(item.id, item);
					}
					return [...byId.values()];
				})()
			: items.map((item) => ({ ...item }));
		session.todos = next;
		this.persist();
		return session.todos.map((item) => ({ ...item }));
	}
}

export function createTranscriptEntry(
	overrides: Omit<ChatTranscriptEntry, "id" | "timestamp"> & Partial<Pick<ChatTranscriptEntry, "id" | "timestamp">>,
): ChatTranscriptEntry {
	return {
		id: overrides.id ?? generateId(),
		timestamp: overrides.timestamp ?? Date.now(),
		...overrides,
	};
}
