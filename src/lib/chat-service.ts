import { buildQueryContext } from "./chat/query-context";
import { createTranscriptEntry, ChatSessionStore } from "./chat/session-store";
import { buildAnthropicRequest } from "./chat/request-builder";
import { resolveChatModelProfile } from "./chat/model-profiles";
import { executeToolCalls } from "./chat/tools/tool-orchestration";
import { createToolContext } from "./chat/tools/tool-runtime";
import type { JsonObject } from "./chat/tools/tool-types";
import { LlamaChatAdapter } from "./chat/transports/llama-adapter";
import type {
	ChatMessage,
	ChatMode,
	ChatSession,
	ChatTranscriptEntry,
	ChatUiEvent,
} from "./chat/types";
import { lmsServerService, type LMSInstalledModelInfo } from "./server-service";

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

export class ChatService {
	private readonly _onDidUpdateSession = new SimpleEmitter<ChatSession>();
	readonly onDidUpdateSession = this._onDidUpdateSession.on.bind(this._onDidUpdateSession);

	private readonly _onDidStreamEvent = new SimpleEmitter<ChatUiEvent>();
	readonly onDidStreamEvent = this._onDidStreamEvent.on.bind(this._onDidStreamEvent);

	private readonly store = new ChatSessionStore();
	private readonly transport = new LlamaChatAdapter();
	private _currentModel: LMSInstalledModelInfo | null = null;
	private _abortController: AbortController | null = null;
	private _streamingSessionId: string | null = null;
	private _isSending = false;
	private _queuedMessages: Array<{
		content: string;
		options?: {
			serverUrl?: string;
			mode?: ChatMode;
		};
		resolve: () => void;
		reject: (error: unknown) => void;
	}> = [];

	get sessions(): ChatSession[] {
		return this.store.getSnapshots();
	}

	get activeSession(): ChatSession | null {
		return this.store.getActiveSnapshot();
	}

	get currentModel(): LMSInstalledModelInfo | null {
		return this._currentModel;
	}

	get streamingSessionId(): string | null {
		return this._streamingSessionId;
	}

	set currentModel(model: LMSInstalledModelInfo | null) {
		this._currentModel = model;
		const active = this.activeSession;
		if (!active) return;
		const updated = this.store.setSessionModel(active.id, model?.id ?? null);
		if (updated) {
			this._onDidUpdateSession.fire(updated);
		}
	}

	createSession(title = "New Chat"): ChatSession {
		const session = this.store.createSession(title, this._currentModel?.id ?? null);
		this._onDidUpdateSession.fire(session);
		return session;
	}

	ensureSession(): ChatSession {
		const session = this.store.ensureSession(this._currentModel?.id ?? null);
		this._onDidUpdateSession.fire(session);
		return session;
	}

	setActiveSession(sessionId: string): void {
		const session = this.store.setActiveSession(sessionId);
		if (session) {
			this._onDidUpdateSession.fire(session);
		}
	}

	setMode(mode: ChatMode): void {
		const active = this.activeSession;
		if (!active) {
			this.store.setDefaultMode(mode);
			return;
		}
		const updated = this.store.setSessionMode(active.id, mode);
		if (updated) {
			this._onDidUpdateSession.fire(updated);
		}
	}

	async sendMessage(
		content: string,
		options?: {
			serverUrl?: string;
			mode?: ChatMode;
		},
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const task = { content, options, resolve, reject };
			if (this._isSending) {
				this._queuedMessages.push(task);
				return;
			}
			void this.executeTask(task);
		});
	}

	private async runSendMessage(
		content: string,
		options?: {
			serverUrl?: string;
			mode?: ChatMode;
		},
	): Promise<void> {
		let session = this.store.ensureSession(this._currentModel?.id ?? null);
		if (options?.mode && session.mode !== options.mode) {
			session = this.store.setSessionMode(session.id, options.mode) ?? session;
		}

		const resolvedModel = this._currentModel?.id ?? session.modelId ?? "default";
		console.log("[ChatService] sendMessage:", {
			content: content.slice(0, 80),
			currentModelId: this._currentModel?.id ?? null,
			currentModelName: this._currentModel?.displayName ?? null,
			sessionModelId: session.modelId,
			resolvedModel,
			mode: session.mode,
		});

		const userMessage = createTranscriptEntry({
			role: "user",
			content,
			visibility: "visible",
			includeInHistory: true,
			subtype: "message",
		});
		session = this.commitEntry(session.id, userMessage) ?? session;

		const abortController = new AbortController();
		this._abortController = abortController;
		this._streamingSessionId = session.id;
		this._onDidStreamEvent.fire({
			type: "stream_request_start",
			sessionId: session.id,
		});

		try {
			for (let iteration = 0; iteration < 8; iteration++) {
				let assistantContent = "";
				let assistantToolCalls: Array<{
					id: string;
					name: string;
					input: JsonObject;
				}> = [];
				const profile = resolveChatModelProfile({
					modelId: resolvedModel,
					modelName: this._currentModel?.displayName,
				});
				const toolContext =
					profile.nativeToolCalling === "supported"
						? await createToolContext({
								sessionId: session.id,
								modelId: resolvedModel,
								signal: abortController.signal,
								stopGeneration: () => this.stopGeneration(),
								setMode: (mode) => this.setMode(mode),
								getTodos: () => this.store.getSessionTodos(session.id),
								setTodos: (items, merge) => this.updateSessionTodos(session.id, items, merge),
							})
						: undefined;
				const queryContext = buildQueryContext({ session });
				const request = buildAnthropicRequest({
					session,
					queryContext,
					model: resolvedModel,
					modelName: this._currentModel?.displayName,
					toolContext,
				});

				for await (const event of this.transport.stream(request, {
					serverUrl: options?.serverUrl,
					signal: abortController.signal,
				})) {
					if (event.type === "content_delta") {
						assistantContent += event.text;
					} else if (event.type === "tool_calls") {
						assistantToolCalls = event.calls;
					}
					this._onDidStreamEvent.fire({
						type: "stream_event",
						sessionId: session.id,
						event,
					});
				}

				if (assistantContent) {
					this.commitEntry(
						session.id,
						createTranscriptEntry({
							role: "assistant",
							content: assistantContent,
							visibility: "visible",
							includeInHistory: true,
							subtype: "message",
						}),
					);
				}

				if (assistantToolCalls.length === 0) {
					break;
				}
				if (!toolContext) {
					throw new Error("Received tool calls for a model without native tool support.");
				}

				const executed = await executeToolCalls(assistantToolCalls, toolContext);
				for (const item of executed) {
					this.commitEntry(
						session.id,
						createTranscriptEntry({
							role: "assistant",
							content: `${item.call.name}(${JSON.stringify(item.call.input)})`,
							visibility: "visible",
							includeInHistory: true,
							subtype: "tool_use",
							toolInvocation: {
								toolCallId: item.call.id,
								toolName: item.call.name,
								input: item.call.input as JsonObject,
							},
						}),
					);
					this.commitEntry(
						session.id,
						createTranscriptEntry({
							role: "tool",
							content: item.result.content,
							visibility: "visible",
							includeInHistory: true,
							subtype: "tool_result",
							toolResult: {
								toolCallId: item.call.id,
								toolName: item.call.name,
								input: item.call.input as JsonObject,
								outputText: item.result.content,
								display: item.result.display,
								isError: item.result.isError,
								structuredContent: item.result.structuredContent,
							},
						}),
					);
				}

				session = this.store.getSnapshot(session.id) ?? session;
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				this.commitEntry(
					session.id,
					createTranscriptEntry({
						role: "system",
						content: "[Request interrupted by user]",
						visibility: "visible",
						includeInHistory: false,
						isMeta: true,
						subtype: "interruption",
					}),
				);
			} else {
				this.commitEntry(
					session.id,
					createTranscriptEntry({
						role: "assistant",
						content: `Error: ${error instanceof Error ? error.message : String(error)}`,
						visibility: "visible",
						includeInHistory: false,
						subtype: "error",
					}),
				);
			}
		} finally {
			if (this._abortController === abortController) {
				this._abortController = null;
			}
			this._streamingSessionId = null;
		}
	}

	private async executeTask(task: {
		content: string;
		options?: {
			serverUrl?: string;
			mode?: ChatMode;
		};
		resolve: () => void;
		reject: (error: unknown) => void;
	}): Promise<void> {
		this._isSending = true;
		try {
			await this.runSendMessage(task.content, task.options);
			task.resolve();
		} catch (error) {
			task.reject(error);
		} finally {
			const next = this._queuedMessages.shift();
			if (next) {
				void this.executeTask(next);
			} else {
				this._isSending = false;
			}
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

	private commitEntry(sessionId: string, entry: ChatTranscriptEntry): ChatSession | null {
		this._onDidStreamEvent.fire({
			type: "message",
			sessionId,
			message: this.toChatMessage(entry),
		});
		const session = this.store.appendEntry(sessionId, entry);
		if (session) {
			const snapshot = this.store.getSnapshot(session.id) ?? session;
			this._onDidUpdateSession.fire(snapshot);
		}
		return session;
	}

	private toChatMessage(entry: ChatTranscriptEntry): ChatMessage {
		return {
			id: entry.id,
			role: entry.role,
			content: entry.content,
			timestamp: entry.timestamp,
			isStreaming: entry.isStreaming,
			subtype: entry.subtype,
			toolInvocation: entry.toolInvocation,
			toolResult: entry.toolResult,
		};
	}

	private updateSessionTodos(
		sessionId: string,
		items: Array<{
			id: string;
			content: string;
			status: "pending" | "in_progress" | "completed" | "cancelled";
		}>,
		merge: boolean,
	) {
		const next = this.store.updateSessionTodos(sessionId, items, merge);
		const snapshot = this.store.getSnapshot(sessionId);
		if (snapshot) {
			this._onDidUpdateSession.fire(snapshot);
		}
		return next;
	}
}

export const chatService = new ChatService();
export type { ChatMessage, ChatSession } from "./chat/types";
