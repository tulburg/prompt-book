import { lmsServerService, type LMSInstalledModelInfo } from "./lms-server-service";

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
	isStreaming?: boolean;
}

export interface ChatSession {
	id: string;
	title: string;
	messages: ChatMessage[];
	modelId: string | null;
	createdAt: number;
}

type Listener<T> = (value: T) => void;

class SimpleEmitter<T> {
	private listeners = new Set<Listener<T>>();

	on(listener: Listener<T>): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	fire(value: T): void {
		for (const listener of this.listeners) {
			listener(value);
		}
	}
}

const DEFAULT_SERVER_URL = "http://localhost:8123";

function extractContentText(content: string | Array<{ type?: string; text?: string }> | undefined | null): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
	return "";
}

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class ChatService {
	private readonly _onDidUpdateSession = new SimpleEmitter<ChatSession>();
	readonly onDidUpdateSession = this._onDidUpdateSession.on.bind(this._onDidUpdateSession);

	private readonly _onDidStreamChunk = new SimpleEmitter<{ sessionId: string; messageId: string; chunk: string }>();
	readonly onDidStreamChunk = this._onDidStreamChunk.on.bind(this._onDidStreamChunk);

	private _sessions: ChatSession[] = [];
	private _activeSessionId: string | null = null;
	private _currentModel: LMSInstalledModelInfo | null = null;
	private _abortController: AbortController | null = null;

	get sessions(): ChatSession[] {
		return this._sessions;
	}

	get activeSession(): ChatSession | null {
		return this._sessions.find((s) => s.id === this._activeSessionId) ?? null;
	}

	get currentModel(): LMSInstalledModelInfo | null {
		return this._currentModel;
	}

	set currentModel(model: LMSInstalledModelInfo | null) {
		this._currentModel = model;
	}

	createSession(title = "New Chat"): ChatSession {
		const session: ChatSession = {
			id: generateId(),
			title,
			messages: [],
			modelId: this._currentModel?.id ?? null,
			createdAt: Date.now(),
		};
		this._sessions.push(session);
		this._activeSessionId = session.id;
		return session;
	}

	setActiveSession(sessionId: string): void {
		this._activeSessionId = sessionId;
	}

	async sendMessage(content: string, serverUrl?: string): Promise<void> {
		let session = this.activeSession;
		if (!session) {
			session = this.createSession();
		}

		const userMessage: ChatMessage = {
			id: generateId(),
			role: "user",
			content,
			timestamp: Date.now(),
		};
		session.messages.push(userMessage);
		this._onDidUpdateSession.fire(session);

		const assistantMessage: ChatMessage = {
			id: generateId(),
			role: "assistant",
			content: "",
			timestamp: Date.now(),
			isStreaming: true,
		};
		session.messages.push(assistantMessage);
		this._onDidUpdateSession.fire(session);

		const baseUrl = (serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "");
		this._abortController = new AbortController();

		try {
			const chatMessages = session.messages
				.filter((m) => !m.isStreaming)
				.map((m) => ({ role: m.role, content: m.content }));
			chatMessages.push({ role: "user", content });

			const response = await fetch(`${baseUrl}/v1/chat/completions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this._currentModel?.id ?? "default",
					messages: chatMessages,
					stream: true,
				}),
				signal: this._abortController.signal,
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => "");
				throw new Error(`Chat request failed: HTTP ${response.status}${errorText ? ` — ${errorText}` : ""}`);
			}

			const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
			const isSSE = contentType.includes("text/event-stream") && response.body;

			if (isSSE) {
				const reader = response.body!.getReader();
				const decoder = new TextDecoder();
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

					while (true) {
						const boundary = buffer.indexOf("\n\n");
						if (boundary === -1) break;

						const eventBlock = buffer.slice(0, boundary);
						buffer = buffer.slice(boundary + 2);
						const data = eventBlock
							.split("\n")
							.filter((line) => line.startsWith("data:"))
							.map((line) => line.slice(5).trimStart())
							.join("\n")
							.trim();

						if (!data || data === "[DONE]") continue;

						try {
							const parsed = JSON.parse(data) as {
								choices?: Array<{
									delta?: { content?: string | Array<{ type?: string; text?: string }> };
									message?: { content?: string | Array<{ type?: string; text?: string }> };
								}>;
							};
							for (const choice of parsed.choices ?? []) {
								const source = choice.delta ?? choice.message;
								const chunk = extractContentText(source?.content);
								if (chunk) {
									assistantMessage.content += chunk;
									this._onDidStreamChunk.fire({
										sessionId: session!.id,
										messageId: assistantMessage.id,
										chunk,
									});
								}
							}
						} catch {
							// skip unparseable event blocks
						}
					}
				}
			} else {
				const payload = (await response.json()) as {
					choices?: Array<{
						message?: { content?: string | Array<{ type?: string; text?: string }> };
					}>;
				};
				for (const choice of payload.choices ?? []) {
					const chunk = extractContentText(choice.message?.content);
					if (chunk) {
						assistantMessage.content += chunk;
						this._onDidStreamChunk.fire({
							sessionId: session!.id,
							messageId: assistantMessage.id,
							chunk,
						});
					}
				}
			}

			assistantMessage.isStreaming = false;
			assistantMessage.timestamp = Date.now();
			this._onDidUpdateSession.fire(session!);
		} catch (error) {
			assistantMessage.isStreaming = false;
			if (error instanceof Error && error.name === "AbortError") {
				assistantMessage.content += "\n\n*[Generation stopped]*";
			} else {
				assistantMessage.content = `Error: ${error instanceof Error ? error.message : String(error)}`;
			}
			this._onDidUpdateSession.fire(session!);
		} finally {
			this._abortController = null;
		}
	}

	stopGeneration(): void {
		this._abortController?.abort();
		this._abortController = null;
	}

	async getInstalledModels(serverUrl?: string): Promise<LMSInstalledModelInfo[]> {
		try {
			return await lmsServerService.listInstalledModels(serverUrl);
		} catch {
			return [];
		}
	}
}

export const chatService = new ChatService();
