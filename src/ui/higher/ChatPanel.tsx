import * as React from "react";
import {
	ChevronDown,
	ImageIcon,
	Mic,
	Plus,
	MoreHorizontal,
	Clock,
	Loader2,
	Download,
	AlertCircle,
	Square,
} from "lucide-react";
import { chatService, type ChatMessage, type ChatSession } from "@/lib/chat-service";
import { handleChatStreamEvent } from "@/lib/chat/stream-events";
import { lmsServerService, type LMSInstalledModelInfo } from "@/lib/server-service";
import {
	fetchModelCatalog,
	LMS_MODEL_CATALOG_FALLBACK,
	type LMSModelEntry,
} from "@/lib/model-catalog";
import type { ChatMode } from "@/lib/chat/types";

interface ChatPanelProps {
	className?: string;
}

export function ChatPanel({ className }: ChatPanelProps) {
	const [sessions, setSessions] = React.useState<ChatSession[]>([]);
	const [activeSession, setActiveSession] = React.useState<ChatSession | null>(null);
	const [inputValue, setInputValue] = React.useState("");
	const [isStreaming, setIsStreaming] = React.useState(false);
	const [installedModels, setInstalledModels] = React.useState<LMSInstalledModelInfo[]>([]);
	const [selectedModel, setSelectedModel] = React.useState<LMSInstalledModelInfo | null>(null);
	const [serverStatus, setServerStatus] = React.useState<"stopped" | "starting" | "running" | "error">("stopped");
	const [showModelPicker, setShowModelPicker] = React.useState(false);
	const [showModePicker, setShowModePicker] = React.useState(false);
	const [chatMode, setChatMode] = React.useState<ChatMode>("Agent");
	const [showDownloadPanel, setShowDownloadPanel] = React.useState(false);
	const [downloadCatalog, setDownloadCatalog] = React.useState<LMSModelEntry[]>(LMS_MODEL_CATALOG_FALLBACK);
	const [downloadProgress, setDownloadProgress] = React.useState<Map<string, { progress: number; message: string }>>(new Map());
	const [isLoadingModel, setIsLoadingModel] = React.useState(false);
	const [streamingText, setStreamingText] = React.useState<string | null>(null);
	const [modePickerPos, setModePickerPos] = React.useState<{ top: number; left: number } | null>(null);
	const [modelPickerPos, setModelPickerPos] = React.useState<{ top: number; left: number } | null>(null);
	const messagesEndRef = React.useRef<HTMLDivElement>(null);
	const textareaRef = React.useRef<HTMLTextAreaElement>(null);
	const modelPickerRef = React.useRef<HTMLDivElement>(null);
	const modePickerRef = React.useRef<HTMLDivElement>(null);
	const modeButtonRef = React.useRef<HTMLButtonElement>(null);
	const modelButtonRef = React.useRef<HTMLButtonElement>(null);
	const activeSessionIdRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		const checkServer = async () => {
			const healthy = await lmsServerService.isServerHealthy();
			if (healthy) {
				setServerStatus("running");
				const models = await chatService.getInstalledModels();
				setInstalledModels(models);
				if (models.length > 0 && !selectedModel) {
					setSelectedModel(models[0]);
					chatService.currentModel = models[0];
					setIsLoadingModel(true);
					try {
						await lmsServerService.loadModel(models[0].id);
					} catch (error) {
						console.error("Failed to load initial model:", error);
					} finally {
						setIsLoadingModel(false);
					}
				}
			}
		};
		checkServer();

		const unsubStatus = lmsServerService.onDidChangeStatus((status) => {
			setServerStatus(status);
		});

		const unsubSession = chatService.onDidUpdateSession((session) => {
			setSessions([...chatService.sessions]);
			const nextActive = chatService.activeSession;
			activeSessionIdRef.current = nextActive?.id ?? null;
			setActiveSession(nextActive ? { ...nextActive } : null);
			if (nextActive) {
				setChatMode(nextActive.mode);
				setIsStreaming(chatService.streamingSessionId === nextActive.id);
			} else {
				setIsStreaming(false);
			}
		});

		const unsubStream = chatService.onDidStreamEvent((event) => {
			handleChatStreamEvent(event, {
				onMessage: ({ sessionId }) => {
					if (sessionId !== activeSessionIdRef.current) return;
					setStreamingText(null);
					setIsStreaming(false);
				},
				onSetStreamMode: (mode) => {
					if (event.sessionId !== activeSessionIdRef.current) return;
					setIsStreaming(mode !== "idle");
				},
				onStreamingText: (updater) => {
					if (event.sessionId !== activeSessionIdRef.current) return;
					setStreamingText(updater);
				},
			});
		});

		const unsubPull = lmsServerService.onDidPullProgress(({ modelId, message }) => {
			setDownloadProgress((prev) => {
				const next = new Map(prev);
				const pctMatch = message.match(/([\d.]+)%/);
				const progress = pctMatch ? parseFloat(pctMatch[1]) : prev.get(modelId)?.progress ?? 0;
				next.set(modelId, { progress, message });
				return next;
			});
		});

		const session = chatService.ensureSession();
		activeSessionIdRef.current = session.id;
		setActiveSession(session);
		setSessions([...chatService.sessions]);
		setChatMode(session.mode);

		return () => {
			unsubStatus();
			unsubSession();
			unsubStream();
			unsubPull();
		};
	}, [selectedModel]);

	React.useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [activeSession?.messages, streamingText, isStreaming]);

	React.useEffect(() => {
		activeSessionIdRef.current = activeSession?.id ?? null;
	}, [activeSession?.id]);

	React.useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			const target = e.target as Node;
			if (showModelPicker && modelPickerRef.current && !modelPickerRef.current.contains(target)) {
				setShowModelPicker(false);
			}
			if (showModePicker && modePickerRef.current && !modePickerRef.current.contains(target)) {
				setShowModePicker(false);
			}
		};
		const handleScroll = () => {
			setShowModelPicker(false);
			setShowModePicker(false);
		};
		document.addEventListener("mousedown", handleClickOutside);
		window.addEventListener("resize", handleScroll);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			window.removeEventListener("resize", handleScroll);
		};
	}, [showModelPicker, showModePicker]);

	const handleSend = async () => {
		const trimmed = inputValue.trim();
		if (!trimmed || isStreaming) return;

		setInputValue("");
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
		}

		await chatService.sendMessage(trimmed, { mode: chatMode });
	};

	const handleStopGeneration = () => {
		chatService.stopGeneration();
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setInputValue(e.target.value);
		const textarea = e.target;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
	};

	const handleNewChat = () => {
		const session = chatService.createSession();
		activeSessionIdRef.current = session.id;
		setActiveSession(session);
		setSessions([...chatService.sessions]);
		setChatMode(session.mode);
		setInputValue("");
		setStreamingText(null);
	};

	const handleSelectModel = async (model: LMSInstalledModelInfo) => {
		console.log("[ChatPanel] handleSelectModel:", model.id, model.displayName);
		setSelectedModel(model);
		chatService.currentModel = model;
		setShowModelPicker(false);
		setIsLoadingModel(true);
		try {
			console.log("[ChatPanel] calling loadModel...");
			await lmsServerService.loadModel(model.id);
			console.log("[ChatPanel] loadModel done ✓");
		} catch (error) {
			console.error("[ChatPanel] Failed to load model:", error);
		} finally {
			setIsLoadingModel(false);
			console.log("[ChatPanel] isLoadingModel → false");
		}
	};

	const handleDownloadModel = async (entry: LMSModelEntry) => {
		setShowDownloadPanel(false);
		try {
			await lmsServerService.pullModel(entry.id, entry.quantization);
			const models = await chatService.getInstalledModels();
			setInstalledModels(models);
		} catch (error) {
			console.error("Download failed:", error);
		}
	};

	const handleFetchCatalog = async () => {
		setShowDownloadPanel(true);
		try {
			const catalog = await fetchModelCatalog();
			setDownloadCatalog(catalog);
		} catch {
			setDownloadCatalog(LMS_MODEL_CATALOG_FALLBACK);
		}
	};

	const messages = activeSession?.messages ?? [];
	const visibleStreamingText = streamingText;

	return (
		<div className={`flex h-full flex-col overflow-hidden rounded-2xl border border-border-500 bg-panel ${className ?? ""}`}>
			{/* Tab bar */}
			<div className="flex h-[35px] shrink-0 items-center justify-between border-b border-border-500 px-1">
				<div className="flex min-w-0 flex-1 items-center overflow-x-auto scrollbar-none">
					{sessions.map((session) => (
						<button
							key={session.id}
							className={`cursor-pointer whitespace-nowrap border-b-2 border-transparent bg-transparent px-3 py-1.5 text-xs text-foreground-900 transition-colors duration-150 hover:text-foreground ${session.id === activeSession?.id ? "!border-b-foreground font-semibold !text-foreground" : ""}`}
							onClick={() => {
								chatService.setActiveSession(session.id);
								activeSessionIdRef.current = session.id;
								setActiveSession(chatService.activeSession);
								setStreamingText(null);
							}}
						>
							{session.title}
						</button>
					))}
					<button
						className="cursor-pointer whitespace-nowrap border-b-2 border-foreground bg-transparent px-3 py-1.5 text-xs font-semibold text-foreground"
						onClick={handleNewChat}
					>
						New Chat
					</button>
				</div>
				<div className="flex shrink-0 items-center gap-0.5 px-1">
					<button className="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground" onClick={handleNewChat}>
						<Plus className="h-3.5 w-3.5" />
					</button>
					<button className="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground">
						<Clock className="h-3.5 w-3.5" />
					</button>
					<button className="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground">
						<MoreHorizontal className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{/* Input area at top */}
			<div className="flex shrink-0 flex-col gap-1 px-3 py-2">
				<div className="relative box-border w-full cursor-text rounded-[10px] border border-border-500 bg-panel-600 px-1.5 pb-1.5 focus-within:border-sky">
					<textarea
						ref={textareaRef}
						className="w-full min-h-[60px] max-h-[200px] resize-none border-none bg-transparent px-1.5 pt-2.5 pb-1 text-[13px] font-[inherit] leading-relaxed text-foreground outline-none placeholder:text-placeholder"
						placeholder="Plan, @ for context, / for commands"
						value={inputValue}
						onChange={handleTextareaInput}
						onKeyDown={handleKeyDown}
						rows={3}
					/>
					<div className="flex items-center justify-between gap-1.5 pt-0.5">
						<div className="flex min-w-0 flex-1 items-center gap-1">
						{/* Mode picker */}
						<div className="relative" ref={modePickerRef}>
							<button
								ref={modeButtonRef}
								className="flex h-[22px] cursor-pointer items-center gap-1 whitespace-nowrap rounded border-none bg-transparent px-1.5 py-0.5 text-xs text-foreground-900 hover:bg-border-500 hover:text-foreground"
								onClick={() => {
									if (!showModePicker && modeButtonRef.current) {
										const rect = modeButtonRef.current.getBoundingClientRect();
										setModePickerPos({ top: rect.bottom + 4, left: rect.left });
									}
									setShowModePicker(!showModePicker);
								}}
							>
								<span className="text-[10px] tracking-[-2px]">&#8734;&#8734;</span>
								<span className="max-w-[120px] overflow-hidden text-ellipsis">{chatMode}</span>
								<ChevronDown className="h-3 w-3" />
							</button>
							{showModePicker && modePickerPos && (
								<div
									className="fixed z-[1000] min-w-[150px] rounded-md border border-border-500 bg-panel-600 p-1 shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
									style={{ top: modePickerPos.top, left: modePickerPos.left }}
								>
									{(["Agent", "Ask", "Edit"] as const).map((mode) => (
										<button
											key={mode}
											className={`flex w-full cursor-pointer items-center rounded px-2 py-1.5 border-none bg-transparent text-left text-xs text-foreground hover:bg-border-500 ${mode === chatMode ? "bg-highlight text-sky" : ""}`}
											onClick={() => {
												chatService.setMode(mode);
												setChatMode(mode);
												setShowModePicker(false);
											}}
										>
											{mode}
										</button>
									))}
								</div>
							)}
						</div>

						{/* Model picker */}
						<div className="relative" ref={modelPickerRef}>
							<button
								ref={modelButtonRef}
								className="flex h-[22px] cursor-pointer items-center gap-1 whitespace-nowrap rounded border-none bg-transparent px-1.5 py-0.5 text-xs text-foreground-900 hover:bg-border-500 hover:text-foreground"
								onClick={() => {
									if (!showModelPicker && modelButtonRef.current) {
										const rect = modelButtonRef.current.getBoundingClientRect();
										setModelPickerPos({ top: rect.bottom + 4, left: rect.left });
									}
									setShowModelPicker(!showModelPicker);
								}}
							>
								{isLoadingModel && <Loader2 className="h-3 w-3 animate-spin" />}
								<span className="max-w-[120px] overflow-hidden text-ellipsis">
									{selectedModel?.displayName ?? "No model"}
								</span>
								<ChevronDown className="h-3 w-3" />
							</button>
							{showModelPicker && modelPickerPos && (
								<div
									className="fixed z-[1000] max-h-[300px] min-w-[220px] overflow-y-auto rounded-md border border-border-500 bg-panel-600 p-1 shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
									style={{ top: modelPickerPos.top, left: modelPickerPos.left }}
								>
									{installedModels.length > 0 ? (
										installedModels.map((model) => (
											<button
												key={model.id}
												className={`flex w-full cursor-pointer items-center rounded px-2 py-1.5 border-none bg-transparent text-left text-xs text-foreground hover:bg-border-500 ${model.id === selectedModel?.id ? "bg-highlight text-sky" : ""}`}
												onClick={() => handleSelectModel(model)}
											>
												<span>{model.displayName}</span>
											</button>
										))
									) : (
										<div className="p-2 text-center text-xs text-placeholder">
											No models installed
										</div>
									)}
									<div className="my-1 h-px bg-border-500" />
									<button
										className="flex w-full cursor-pointer items-center rounded px-2 py-1.5 border-none bg-transparent text-left text-xs text-foreground hover:bg-border-500"
										onClick={handleFetchCatalog}
									>
										<Download className="mr-2 h-3.5 w-3.5" />
										Add Local Model...
									</button>
								</div>
							)}
						</div>
						</div>

						<div className="flex shrink-0 items-center gap-1">
							<button className="flex size-7 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground">
								<ImageIcon className="h-4 w-4" />
							</button>
							<button
								className="flex size-7 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground"
								onClick={isStreaming ? handleStopGeneration : undefined}
								aria-label={isStreaming ? "Stop generation" : "Voice input"}
								title={isStreaming ? "Stop generation" : "Voice input"}
							>
								{isStreaming ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-4 w-4" />}
							</button>
						</div>
					</div>
				</div>

				{/* Scope selector */}
				<div className="py-0.5">
					<button className="flex cursor-pointer items-center gap-1 rounded border-none bg-transparent px-1.5 py-0.5 text-xs text-foreground-900 hover:text-foreground">
						<span className="text-sm">&#9633;</span>
						<span>Local</span>
						<ChevronDown className="h-3 w-3" />
					</button>
				</div>
			</div>

			{/* Messages area */}
			<div className="min-h-0 flex-1 overflow-y-auto text-foreground">
				{messages.length === 0 ? (
					<div className="flex h-full flex-col items-center justify-center gap-3">
						{serverStatus !== "running" && (
							<div className="flex flex-col items-center gap-2">
								{serverStatus === "stopped" && (
									<>
										<AlertCircle className="h-5 w-5 text-foreground/40" />
										<span className="text-foreground/40">
											Local model server not running
										</span>
										<button
											className="cursor-pointer rounded-md border border-border-500 bg-sky px-4 py-1.5 text-xs text-white hover:opacity-90"
											onClick={async () => {
												await lmsServerService.startServer();
												const models = await chatService.getInstalledModels();
												setInstalledModels(models);
												if (models.length > 0) {
													setSelectedModel(models[0]);
													chatService.currentModel = models[0];
													setIsLoadingModel(true);
													try {
														await lmsServerService.loadModel(models[0].id);
													} catch (error) {
														console.error("Failed to load model:", error);
													} finally {
														setIsLoadingModel(false);
													}
												}
											}}
										>
											Start Server
										</button>
									</>
								)}
								{serverStatus === "starting" && (
									<>
										<Loader2 className="h-5 w-5 animate-spin text-foreground/40" />
										<span className="text-foreground/40">Starting server...</span>
									</>
								)}
								{serverStatus === "error" && (
									<>
										<AlertCircle className="h-5 w-5 text-red-400" />
										<span className="text-red-400">Server error</span>
									</>
								)}
							</div>
						)}
					</div>
				) : (
					<div className="mx-auto flex max-w-[950px] flex-col">
						{messages.map((msg) => (
							<ChatMessageItem key={msg.id} message={msg} />
						))}
						{isStreaming && (
							<ChatMessageItem
								message={{
									id: "streaming-preview",
									role: "assistant",
									content: visibleStreamingText ?? "",
									timestamp: Date.now(),
									isStreaming: true,
									subtype: "message",
								}}
							/>
						)}
						<div ref={messagesEndRef} />
					</div>
				)}
			</div>

			{/* Download panel overlay */}
			{showDownloadPanel && (
				<div className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-panel">
					<div className="flex shrink-0 items-center justify-between border-b border-border-500 px-4 py-3 text-[13px] font-semibold text-foreground">
						<span>Choose a model to download</span>
						<button
							className="cursor-pointer border-none bg-transparent px-1 text-lg text-foreground-900 hover:text-foreground"
							onClick={() => setShowDownloadPanel(false)}
						>
							&times;
						</button>
					</div>
					<div className="flex-1 overflow-y-auto p-2">
						{downloadCatalog.map((entry) => {
							const dlState = downloadProgress.get(entry.id);
							return (
								<div key={entry.id} className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-panel-400">
									<div className="flex min-w-0 flex-1 flex-col gap-0.5">
										<span className="flex items-center gap-1.5 text-[13px] text-foreground">
											{entry.name}
											{entry.recommended && (
												<span className="rounded bg-highlight px-1.5 py-px text-[10px] text-sky">Recommended</span>
											)}
										</span>
										<span className="text-[11px] text-placeholder">
											{entry.size} · {entry.description}
										</span>
									</div>
									{dlState ? (
										<div className="flex min-w-[100px] shrink-0 flex-col gap-1">
											<div className="h-1 overflow-hidden rounded-sm bg-border-500">
												<div
													className="h-full rounded-sm bg-sky transition-[width] duration-300 ease-out"
													style={{ width: `${dlState.progress}%` }}
												/>
											</div>
											<span className="text-[10px] text-placeholder">
												{dlState.message}
											</span>
										</div>
									) : (
										<button
											className="shrink-0 cursor-pointer rounded border-none bg-sky px-3 py-1 text-xs text-white hover:opacity-90"
											onClick={() => handleDownloadModel(entry)}
										>
											Download
										</button>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Footer usage indicator */}
			<div className="shrink-0 border-t border-border-500 px-4 py-2">
				<div className="flex items-center gap-1.5 text-xs text-placeholder">
					<span className="text-sm text-sky-700">&#9673;</span>
					<span>Local model</span>
				</div>
			</div>
		</div>
	);
}

function ChatMessageItem({ message }: { message: ChatMessage }) {
	const isUser = message.role === "user";
	const isNotice = message.role === "system" || message.subtype === "error" || message.subtype === "interruption";

	return (
		<div className={`flex cursor-default select-text flex-col px-4 py-1.5 ${isUser ? "items-end" : ""}`}>
			{!isUser && (
				<div className="mb-1 flex items-center gap-2">
					<div className="flex size-6 items-center justify-center rounded-full bg-border-500">
						<span className="text-sm text-sky">&#10022;</span>
					</div>
				</div>
			)}
			<div className={`w-full ${isUser ? "ml-auto w-fit max-w-[90%] rounded-2xl bg-panel-400 px-3 py-2" : isNotice ? "rounded-xl border border-border-500 bg-panel-300 px-3 py-2" : ""}`}>
				{message.isStreaming && !message.content ? (
					<div className="flex gap-1 py-1">
						<span className="size-1.5 animate-[chat-dot-pulse_1.4s_ease-in-out_infinite] rounded-full bg-placeholder" />
						<span className="size-1.5 animate-[chat-dot-pulse_1.4s_ease-in-out_infinite_0.2s] rounded-full bg-placeholder" />
						<span className="size-1.5 animate-[chat-dot-pulse_1.4s_ease-in-out_infinite_0.4s] rounded-full bg-placeholder" />
					</div>
				) : (
					<div className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${isNotice ? "text-foreground-900" : "text-foreground"}`}>
						{message.content.split("\n").map((line, i) => (
							<React.Fragment key={i}>
								{i > 0 && <br />}
								{line}
							</React.Fragment>
						))}
						{message.isStreaming && <span className="animate-[chat-blink_0.8s_step-end_infinite] text-sky">|</span>}
					</div>
				)}
			</div>
		</div>
	);
}
