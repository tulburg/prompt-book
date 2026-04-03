import { resolveChatModelProfile } from "./chat/model-profiles";
import { buildQueryContext } from "./chat/query-context";
import { buildAnthropicRequest } from "./chat/request-builder";
import { ChatSessionStore, createTranscriptEntry } from "./chat/session-store";
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
import {
	type LlamaInstalledModelInfo,
	llamaServerService,
} from "./server-service";

type Listener<T> = (value: T) => void;

function sanitizeAssistantToolEchoes(
	content: string,
	toolCalls: Array<{ name: string; input: JsonObject }>,
): string {
	if (!content.trim() || toolCalls.length === 0) {
		return content.trim();
	}

	let lines = content.split("\n");
	for (const toolCall of toolCalls) {
		lines = stripToolInvocationEcho(lines, toolCall);
	}

	return lines
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function stripToolInvocationEcho(
	lines: string[],
	toolCall: { name: string; input: JsonObject },
): string[] {
	const invocationLine = `${toolCall.name}(${JSON.stringify(toolCall.input)})`;
	const description = getToolEchoField(toolCall.input, "description");
	const command = getToolEchoField(toolCall.input, "command");
	const nextLines: string[] = [];

	for (let index = 0; index < lines.length; index++) {
		if (lines[index]?.trim() !== invocationLine) {
			nextLines.push(lines[index] ?? "");
			continue;
		}

		let cursor = skipBlankLines(lines, index + 1);
		if (description && lines[cursor]?.trim() === description) {
			cursor = skipBlankLines(lines, cursor + 1);
		}
		if (command && lines[cursor]?.trim() === command) {
			cursor = skipBlankLines(lines, cursor + 1);
		}

		index = cursor - 1;
	}

	return nextLines;
}

function skipBlankLines(lines: string[], startIndex: number): number {
	let index = startIndex;
	while (index < lines.length && lines[index]?.trim() === "") {
		index += 1;
	}
	return index;
}

function getToolEchoField(input: JsonObject, key: string): string | null {
	const value = input[key];
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: null;
}

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
	readonly onDidUpdateSession = this._onDidUpdateSession.on.bind(
		this._onDidUpdateSession,
	);

	private readonly _onDidStreamEvent = new SimpleEmitter<ChatUiEvent>();
	readonly onDidStreamEvent = this._onDidStreamEvent.on.bind(
		this._onDidStreamEvent,
	);

	private readonly store = new ChatSessionStore();
	private readonly transport = new LlamaChatAdapter();
	private _currentModel: LlamaInstalledModelInfo | null = null;
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
		return this.store.getOpenSnapshots();
	}

	get historySessions(): ChatSession[] {
		return this.store.getClosedSnapshots();
	}

	get activeSession(): ChatSession | null {
		return this.store.getActiveSnapshot();
	}

	get currentModel(): LlamaInstalledModelInfo | null {
		return this._currentModel;
	}

	get streamingSessionId(): string | null {
		return this._streamingSessionId;
	}

	set currentModel(model: LlamaInstalledModelInfo | null) {
		this._currentModel = model;
		const active = this.activeSession;
		if (!active) return;
		const updated = this.store.setSessionModel(active.id, model?.id ?? null);
		if (updated) {
			this._onDidUpdateSession.fire(updated);
		}
	}

	createSession(title = "New Chat"): ChatSession {
		const session = this.store.createSession(
			title,
			this._currentModel?.id ?? null,
		);
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

	closeSession(sessionId: string): void {
		if (this._streamingSessionId === sessionId) {
			this.stopGeneration();
		}
		const session =
			this.store.closeSession(sessionId) ??
			this.store.createSession("New Chat", this._currentModel?.id ?? null);
		this._onDidUpdateSession.fire(session);
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

		const resolvedModel =
			this._currentModel?.id ?? session.modelId ?? "default";
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

		const MAX_TOOL_ITERATIONS = 30;
		const MAX_STREAM_RETRIES = 2;
		try {
			let iteration = 0;
			for (; iteration < MAX_TOOL_ITERATIONS; iteration++) {
				console.log(`[ChatService] Tool loop iteration ${iteration + 1}/${MAX_TOOL_ITERATIONS}, session=${session.id}`);
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
								setTodos: (items, merge) =>
									this.updateSessionTodos(session.id, items, merge),
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

				let streamSucceeded = false;
				for (let streamAttempt = 0; streamAttempt <= MAX_STREAM_RETRIES; streamAttempt++) {
					if (abortController.signal.aborted) break;
					if (streamAttempt > 0) {
						console.warn(`[ChatService] Retrying stream (attempt ${streamAttempt + 1}/${MAX_STREAM_RETRIES + 1}) for iteration ${iteration + 1}`);
						assistantContent = "";
						assistantToolCalls = [];
						await new Promise((r) => setTimeout(r, streamAttempt * 2000));
					}
					try {
						for await (const event of this.transport.stream(request, {
							serverUrl: options?.serverUrl,
							signal: abortController.signal,
						})) {
							if (event.type === "content_delta") {
								assistantContent += event.text;
							} else if (event.type === "tool_calls") {
								assistantToolCalls = event.calls;
								console.log(`[ChatService] Received tool_calls (iteration ${iteration + 1}):`, event.calls.map((c) => c.name));
							} else if (event.type === "message_stop") {
								console.log(`[ChatService] message_stop (iteration ${iteration + 1}), contentLen=${assistantContent.length}, toolCalls=${assistantToolCalls.length}`);
							}

							if (event.type === "message_stop" || event.type === "message_start") {
								continue;
							}
							this._onDidStreamEvent.fire({
								type: "stream_event",
								sessionId: session.id,
								event,
							});
						}
						streamSucceeded = true;
						break;
					} catch (streamError) {
						if (streamError instanceof Error && streamError.name === "AbortError") {
							throw streamError;
						}
						const errMsg = streamError instanceof Error ? streamError.message : String(streamError);
						console.error(`[ChatService] Stream error on iteration ${iteration + 1}, attempt ${streamAttempt + 1}: ${errMsg}`);
						if (streamAttempt >= MAX_STREAM_RETRIES) {
							throw streamError;
						}
					}
				}
				if (!streamSucceeded) break;

				const sanitizedAssistantContent = sanitizeAssistantToolEchoes(
					assistantContent,
					assistantToolCalls,
				);
				if (sanitizedAssistantContent) {
					this.commitEntry(
						session.id,
						createTranscriptEntry({
							role: "assistant",
							content: sanitizedAssistantContent,
							visibility: "visible",
							includeInHistory: true,
							subtype: "message",
						}),
					);
				}

				if (assistantToolCalls.length === 0) {
					console.log(`[ChatService] No tool calls, ending loop at iteration ${iteration + 1}`);
					break;
				}
				if (!toolContext) {
					throw new Error(
						"Received tool calls for a model without native tool support.",
					);
				}

				this._onDidStreamEvent.fire({
					type: "stream_event",
					sessionId: session.id,
					event: { type: "tool_executing" },
				});

				console.log(`[ChatService] Executing ${assistantToolCalls.length} tool call(s) (iteration ${iteration + 1}):`, assistantToolCalls.map((c) => `${c.name}(${JSON.stringify(c.input).slice(0, 100)})`));
				const executed = await executeToolCalls(
					assistantToolCalls,
					toolContext,
				);
				console.log(`[ChatService] Tool execution done (iteration ${iteration + 1}), results:`, executed.map((e) => ({ tool: e.call.name, isError: e.result.isError, contentLen: e.result.content.length })));
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

			if (iteration >= MAX_TOOL_ITERATIONS) {
				console.warn(`[ChatService] Tool loop hit max iterations (${MAX_TOOL_ITERATIONS}), session=${session.id}`);
				this.commitEntry(
					session.id,
					createTranscriptEntry({
						role: "assistant",
						content: `Reached the maximum number of tool-use steps (${MAX_TOOL_ITERATIONS}). You can send another message to continue.`,
						visibility: "visible",
						includeInHistory: false,
						subtype: "error",
					}),
				);
			}
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				console.log("[ChatService] Stream aborted by user, session:", session.id);
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
				const errMsg = error instanceof Error ? error.message : String(error);
				const errName = error instanceof Error ? error.name : "Unknown";
				const errStack = error instanceof Error ? error.stack : undefined;
				console.error("[ChatService] Stream error:", { name: errName, message: errMsg, stack: errStack, model: resolvedModel, session: session.id });
				this.commitEntry(
					session.id,
					createTranscriptEntry({
						role: "assistant",
						content: `Error: ${errMsg}`,
						visibility: "visible",
						includeInHistory: false,
						subtype: "error",
					}),
				);
			}
		} finally {
			this._onDidStreamEvent.fire({
				type: "stream_event",
				sessionId: session.id,
				event: { type: "message_stop" },
			});
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

	async getInstalledModels(
		serverUrl?: string,
	): Promise<LlamaInstalledModelInfo[]> {
		try {
			return await llamaServerService.listInstalledModels(serverUrl);
		} catch {
			return [];
		}
	}

	private commitEntry(
		sessionId: string,
		entry: ChatTranscriptEntry,
	): ChatSession | null {
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
