import type {
	ChatMessage,
	ChatMode,
	ChatSession,
	ChatSessionState,
	ChatTranscriptEntry,
} from "./types";

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
		}));
}

function toSnapshot(session: ChatSessionState): ChatSession {
	return {
		...session,
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

	getSnapshots(): ChatSession[] {
		return this.sessions.map(toSnapshot);
	}

	getActiveSnapshot(): ChatSession | null {
		const session = this.sessions.find((candidate) => candidate.id === this.activeSessionId);
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
			transcript: [createBootstrapEntry(mode)],
		};
		this.sessions.push(session);
		this.activeSessionId = session.id;
		return toSnapshot(session);
	}

	setActiveSession(sessionId: string): ChatSession | null {
		const exists = this.sessions.some((session) => session.id === sessionId);
		if (!exists) return null;
		this.activeSessionId = sessionId;
		return this.getActiveSnapshot();
	}

	setSessionMode(sessionId: string, mode: ChatMode): ChatSession | null {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		if (!session) return null;
		session.mode = mode;
		this.defaultMode = mode;
		return toSnapshot(session);
	}

	setSessionModel(sessionId: string, modelId: string | null): ChatSession | null {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		if (!session) return null;
		session.modelId = modelId;
		return toSnapshot(session);
	}

	appendEntry(sessionId: string, entry: ChatTranscriptEntry): ChatSession | null {
		const session = this.sessions.find((candidate) => candidate.id === sessionId);
		if (!session) return null;
		session.transcript.push(entry);
		if (session.title === "New Chat" && entry.role === "user" && entry.visibility === "visible") {
			session.title = deriveTitleFromContent(entry.content);
		}
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
		return toSnapshot(session);
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
