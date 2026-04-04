import {
  type ChatMessage,
  type ChatSession,
  chatService,
} from "@/lib/chat-service";
import {
  getChatModelProviderLabel,
  getConfiguredFrontierModels,
  isLocalChatModel,
  type ChatModelInfo,
} from "@/lib/chat/chat-models";
import { fetchOpenAiModels } from "@/lib/chat/openai-model-discovery";
import { useApplicationSettings } from "@/lib/use-application-settings";
import type { ApplicationSettings } from "@/lib/application-settings";
import { parseAssistantRenderableContent } from "@/lib/chat/render-message-content";
import { handleChatStreamEvent } from "@/lib/chat/stream-events";
import {
  ErrorTimelineRow,
  ToolMessageRenderer,
  ThinkingTimelineRow,
  WorkingTimelineRow,
  AssistantTimelineRow,
} from "@/lib/chat/tools/renderers/ToolMessageRenderer";
import type { ChatMode } from "@/lib/chat/types";
import {
  LLAMA_MODEL_CATALOG_FALLBACK,
  type LlamaModelEntry,
  fetchModelCatalog,
} from "@/lib/model-catalog";
import type { PullProgressEvent } from "@/lib/model-downloads";
import {
  type LlamaInstalledModelInfo,
  llamaServerService,
} from "@/lib/server-service";
import Bus from "@/lib/bus";
import { buildToolMessagePairingIndex } from "@/ui/higher/tool-message-pairing";
import { MarkdownMessage } from "@/ui/higher/MarkdownMessage";
import { DownloadIndicator } from "@/ui/lower/DownloadIndicator";
import { Modal } from "@/ui/lower/Modal";
import { TinyScrollArea } from "@/ui/lower/TinyScrollArea";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  Clock,
  Download,
  ImageIcon,
  Loader2,
  Mic,
  MoreHorizontal,
  Plus,
  Square,
  X,
} from "lucide-react";
import * as React from "react";

interface ChatPanelProps {
  className?: string;
  onOpenFileAtLine?: (path: string, line: number) => void | Promise<void>;
  /** "full" (default) shows tabs + history; "agent" hides them for agent windows */
  variant?: "full" | "agent";
  /** Called when agent window requests close */
  onClose?: () => void;
  /** Initial prompt to auto-send (agent variant only) */
  initialPrompt?: string;
  /** Model ID to use for the agent session */
  initialModelId?: string;
  /** Full model metadata to preserve agent provider selection */
  initialModel?: ChatModelInfo | null;
  /** Optional settings snapshot passed from the launching window */
  initialSettings?: ApplicationSettings | null;
}

function sameModel(
  left: ChatModelInfo | null | undefined,
  right: ChatModelInfo | null | undefined,
): boolean {
  return !!left && !!right && left.id === right.id && left.provider === right.provider;
}

function findMatchingModel(
  models: ChatModelInfo[],
  target: ChatModelInfo | null | undefined,
): ChatModelInfo | null {
  if (!target) return null;
  return (
    models.find((model) => sameModel(model, target)) ??
    models.find((model) => model.id === target.id) ??
    null
  );
}

function resolveChatSettings(
  settings: ApplicationSettings | null | undefined,
  fallbackSettings: ApplicationSettings | null | undefined,
): ApplicationSettings | null {
  if (!settings && !fallbackSettings) {
    return null;
  }
  if (!settings) {
    return fallbackSettings ?? null;
  }
  if (!fallbackSettings) {
    return settings;
  }
  return {
    ...settings,
    "chat.providers.google.apiKey":
      settings["chat.providers.google.apiKey"].trim() ||
      fallbackSettings["chat.providers.google.apiKey"],
    "chat.providers.anthropic.apiKey":
      settings["chat.providers.anthropic.apiKey"].trim() ||
      fallbackSettings["chat.providers.anthropic.apiKey"],
    "chat.providers.openai.apiKey":
      settings["chat.providers.openai.apiKey"].trim() ||
      fallbackSettings["chat.providers.openai.apiKey"],
  };
}

export function ChatPanel({
  className,
  onOpenFileAtLine,
  variant = "full",
  onClose,
  initialPrompt,
  initialModelId,
  initialModel,
  initialSettings,
}: ChatPanelProps) {
  const isAgent = variant === "agent";
  const { isBootstrapping, settings } = useApplicationSettings();
  const effectiveSettings = React.useMemo(
    () => resolveChatSettings(settings, initialSettings),
    [initialSettings, settings],
  );
  // Debug: log settings state in agent windows
  React.useEffect(() => {
    if (!isAgent) return;
    console.log("[ChatPanel:agent] settings state:", {
      isBootstrapping,
      hasSettings: !!settings,
      hasInitialSettings: !!initialSettings,
      hasEffectiveSettings: !!effectiveSettings,
      settingsOpenAiKey: settings?.["chat.providers.openai.apiKey"]?.length ?? 0,
      initialSettingsOpenAiKey: initialSettings?.["chat.providers.openai.apiKey"]?.length ?? 0,
      effectiveOpenAiKey: effectiveSettings?.["chat.providers.openai.apiKey"]?.length ?? 0,
    });
  }, [isAgent, isBootstrapping, settings, initialSettings, effectiveSettings]);
  const [sessions, setSessions] = React.useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = React.useState<ChatSession | null>(
    null,
  );
  const [inputValue, setInputValue] = React.useState("");
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [installedModels, setInstalledModels] = React.useState<
    LlamaInstalledModelInfo[]
  >([]);
  const [selectedModel, setSelectedModel] = React.useState<ChatModelInfo | null>(
    variant === "agent" ? initialModel ?? null : null,
  );
  const [serverStatus, setServerStatus] = React.useState<
    "stopped" | "starting" | "running" | "error"
  >("stopped");
  const [showModelPicker, setShowModelPicker] = React.useState(false);
  const [showModePicker, setShowModePicker] = React.useState(false);
  const [chatMode, setChatMode] = React.useState<ChatMode>("Agent");
  const [showDownloadPanel, setShowDownloadPanel] = React.useState(false);
  const [downloadCatalog, setDownloadCatalog] = React.useState<
    LlamaModelEntry[]
  >(LLAMA_MODEL_CATALOG_FALLBACK);
  const [downloadProgress, setDownloadProgress] = React.useState<
    Map<string, PullProgressEvent>
  >(new Map());
  const [openAiModels, setOpenAiModels] = React.useState<ChatModelInfo[]>([]);
  const [isLoadingOpenAiModels, setIsLoadingOpenAiModels] =
    React.useState(false);
  const [isLoadingModel, setIsLoadingModel] = React.useState(false);
  const [streamingText, setStreamingText] = React.useState<string | null>(null);
  const [showHistory, setShowHistory] = React.useState(false);
  const [modePickerPos, setModePickerPos] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const [modelPickerPos, setModelPickerPos] = React.useState<{
    top: number;
    left: number;
  } | null>(null);
  const [slashMenuOpen, setSlashMenuOpen] = React.useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = React.useState(0);
  const [slashFilter, setSlashFilter] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const modelPickerRef = React.useRef<HTMLDivElement>(null);
  const modePickerRef = React.useRef<HTMLDivElement>(null);
  const modeButtonRef = React.useRef<HTMLButtonElement>(null);
  const modelButtonRef = React.useRef<HTMLButtonElement>(null);
  const activeSessionIdRef = React.useRef<string | null>(null);
  const historyRef = React.useRef<HTMLDivElement>(null);
  const downloadDismissTimersRef = React.useRef<Map<string, number>>(new Map());
  const slashCommands = React.useMemo(
    () => [
      {
        name: "agent",
        description: "Launch an agent in a new window",
        icon: Bot,
      },
    ],
    [],
  );

  const filteredSlashCommands = React.useMemo(() => {
    if (!slashFilter) return slashCommands;
    const lower = slashFilter.toLowerCase();
    return slashCommands.filter((cmd) => cmd.name.startsWith(lower));
  }, [slashCommands, slashFilter]);

  const hasGoogleGeminiConfigured = Boolean(
    effectiveSettings?.["chat.providers.google.apiKey"].trim(),
  );
  const hasAnthropicClaudeConfigured = Boolean(
    effectiveSettings?.["chat.providers.anthropic.apiKey"].trim(),
  );
  const hasOpenAiConfigured = Boolean(
    effectiveSettings?.["chat.providers.openai.apiKey"].trim(),
  );

  React.useEffect(() => {
    const apiKey =
      effectiveSettings?.["chat.providers.openai.apiKey"]?.trim() ?? "";
    if (!apiKey) {
      setOpenAiModels([]);
      setIsLoadingOpenAiModels(false);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    setIsLoadingOpenAiModels(true);

    void fetchOpenAiModels(apiKey, { signal: abortController.signal })
      .then((models) => {
        if (!cancelled) {
          setOpenAiModels(models);
        }
      })
      .catch((error) => {
        if (
          cancelled ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return;
        }
        console.error("[ChatPanel] Failed to fetch OpenAI models:", error);
        setOpenAiModels([]);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingOpenAiModels(false);
        }
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [effectiveSettings?.["chat.providers.openai.apiKey"]]);

  const remoteModels = React.useMemo(
    () => getConfiguredFrontierModels(effectiveSettings, { openAiModels }),
    [effectiveSettings, openAiModels],
  );
  const availableModels = React.useMemo(
    () => [...installedModels, ...remoteModels],
    [installedModels, remoteModels],
  );

  React.useEffect(() => {
    const checkServer = async () => {
      const healthy = await llamaServerService.isServerHealthy();
      if (healthy) {
        setServerStatus("running");
        llamaServerService.startHeartbeat();
        const models = await chatService.getInstalledModels();
        setInstalledModels(models);
      } else {
        setServerStatus("stopped");
      }
    };
    checkServer();

    const unsubStatus = llamaServerService.onDidChangeStatus((status) => {
      setServerStatus(status);
      if (status === "running") {
        llamaServerService.startHeartbeat();
      } else {
        llamaServerService.stopHeartbeat();
      }
    });

    const unsubRecover = llamaServerService.onDidRecover(async () => {
      console.info("[ChatPanel] Server recovered, refreshing model list");
      try {
        const models = await chatService.getInstalledModels();
        setInstalledModels(models);
      } catch (error) {
        console.error("[ChatPanel] Failed to refresh models after recovery:", error);
      }
    });

    const unsubSession = chatService.onDidUpdateSession(() => {
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
        onMessage: () => {
          // Message list updates are handled by onDidUpdateSession.
          // Do NOT set isStreaming here — the tool loop may still be running.
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

    const unsubPull = llamaServerService.onDidPullProgress((event) => {
      setDownloadProgress((prev) => {
        const next = new Map(prev);
        next.set(event.modelId, event);
        return next;
      });

      const existingTimer = downloadDismissTimersRef.current.get(event.modelId);
      if (existingTimer) {
        window.clearTimeout(existingTimer);
        downloadDismissTimersRef.current.delete(event.modelId);
      }

      if (
        event.phase === "complete" ||
        event.phase === "error" ||
        event.phase === "cancelled"
      ) {
        const timeoutId = window.setTimeout(() => {
          setDownloadProgress((prev) => {
            const next = new Map(prev);
            next.delete(event.modelId);
            return next;
          });
          downloadDismissTimersRef.current.delete(event.modelId);
        }, 4000);
        downloadDismissTimersRef.current.set(event.modelId, timeoutId);
      }
    });

    // Agent windows use an isolated session store so they don't collide
    // with the main window's localStorage-backed sessions.
    if (isAgent) {
      chatService.setIsolated(true);
      if (initialModel) {
        chatService.currentModel = initialModel;
      }
    }

    const session = isAgent
      ? chatService.createSession("Agent", initialModel?.id ?? initialModelId)
      : chatService.ensureSession();
    activeSessionIdRef.current = session.id;
    setActiveSession(session);
    setSessions([...chatService.sessions]);
    setChatMode(session.mode);

    return () => {
      unsubStatus();
      unsubRecover();
      unsubSession();
      unsubStream();
      unsubPull();
      llamaServerService.stopHeartbeat();
      for (const timeoutId of downloadDismissTimersRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      downloadDismissTimersRef.current.clear();
    };
  }, []);

  // Agent variant: archive session to main store on unmount
  const sentInitialPromptRef = React.useRef(false);
  const initialModelAppliedRef = React.useRef(false);
  React.useEffect(() => {
    if (!isAgent) return;
    return () => {
      const sid = activeSessionIdRef.current;
      if (sid) {
        chatService.archiveSessionToStorage(sid);
      }
    };
  }, [isAgent]);

  // Agent variant: apply the requested model as soon as we can resolve it.
  React.useEffect(() => {
    if (!isAgent || initialModelAppliedRef.current) return;
    const model =
      initialModel ??
      (initialModelId
        ? availableModels.find((candidate) => candidate.id === initialModelId) ??
          null
        : null);
    if (!model) return;
    initialModelAppliedRef.current = true;
    setSelectedModel(model);
    chatService.currentModel = model;
  }, [isAgent, initialModel, initialModelId, availableModels]);

  // Agent variant: auto-send once the initial model is ready.
  React.useEffect(() => {
    if (!initialPrompt?.trim() || sentInitialPromptRef.current) return;
    if (!isAgent) return;
    if (!activeSession) return;
    const modelForInitialSend = initialModel ?? selectedModel;
    const settingsForInitialSend = effectiveSettings;
    if (!modelForInitialSend) return;
    if (initialModelId && modelForInitialSend.id !== initialModelId) return;
    if (
      !isLocalChatModel(modelForInitialSend) &&
      (isBootstrapping || !settingsForInitialSend)
    ) {
      return;
    }
    console.log("[ChatPanel:agent] initial send settings:", {
      hasSettings: !!settingsForInitialSend,
      openAiKeyLength: settingsForInitialSend?.["chat.providers.openai.apiKey"]?.length ?? 0,
      provider: modelForInitialSend.provider,
      modelId: modelForInitialSend.id,
    });
    sentInitialPromptRef.current = true;
    chatService.setActiveSession(activeSession.id);
    chatService.currentModel = modelForInitialSend;
    void chatService.sendMessage(initialPrompt.trim(), {
      mode: "Agent",
      settings: settingsForInitialSend,
    });
  }, [
    isAgent,
    initialModel,
    initialModelId,
    initialPrompt,
    activeSession,
    selectedModel,
    effectiveSettings,
    isBootstrapping,
  ]);

  React.useEffect(() => {
    const preferredModelId =
      activeSession?.modelId ?? selectedModel?.id ?? initialModel?.id ?? null;
    const preferredModel =
      (selectedModel?.id === preferredModelId ? selectedModel : null) ??
      (initialModel?.id === preferredModelId ? initialModel : null);
    const matchingModel =
      preferredModel != null
        ? findMatchingModel(availableModels, preferredModel)
        : preferredModelId
          ? availableModels.find((model) => model.id === preferredModelId) ?? null
          : null;
    const nextSelectedModel =
      matchingModel ??
      (preferredModelId ? preferredModel : null) ??
      availableModels[0] ??
      null;

    if (sameModel(nextSelectedModel, selectedModel)) {
      return;
    }

    if (!nextSelectedModel) {
      if (selectedModel) {
        setSelectedModel(null);
      }
      chatService.currentModel = null;
      return;
    }

    setSelectedModel(nextSelectedModel);
    chatService.currentModel = nextSelectedModel;
  }, [activeSession?.modelId, availableModels, initialModel, selectedModel]);

  React.useEffect(() => {
    if (!selectedModel || !isLocalChatModel(selectedModel)) {
      setIsLoadingModel(false);
      return;
    }
    if (serverStatus !== "running") {
      setIsLoadingModel(false);
      return;
    }

    let cancelled = false;
    setIsLoadingModel(true);
    void llamaServerService
      .loadModel(selectedModel.id)
      .catch((error) => {
        if (!cancelled) {
          console.error("[ChatPanel] Failed to load selected model:", error);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingModel(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedModel?.id, selectedModel?.provider, serverStatus]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeSession?.messages, streamingText, isStreaming]);

  React.useEffect(() => {
    activeSessionIdRef.current = activeSession?.id ?? null;
  }, [activeSession?.id]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        showModelPicker &&
        modelPickerRef.current &&
        !modelPickerRef.current.contains(target)
      ) {
        setShowModelPicker(false);
      }
      if (
        showModePicker &&
        modePickerRef.current &&
        !modePickerRef.current.contains(target)
      ) {
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

    // Handle slash commands
    const slashMatch = trimmed.match(/^\/(\w+)\s*([\s\S]*)$/);
    if (slashMatch) {
      const command = slashMatch[1].toLowerCase();
      const commandArg = slashMatch[2]?.trim() ?? "";

      if (command === "agent") {
        setInputValue("");
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
        }
        const modelForAgentLaunch = selectedModel ?? chatService.currentModel ?? null;
        const bridge = (window as unknown as Record<string, unknown>)
          .windowBridge as
          | {
              openAgent: (
                prompt: string,
                model?: ChatModelInfo | null,
                settings?: ApplicationSettings | null,
              ) => Promise<unknown>;
            }
          | undefined;
        if (bridge) {
          console.log("[ChatPanel] /agent launch settings:", {
            hasEffectiveSettings: !!effectiveSettings,
            openAiKeyLength: effectiveSettings?.["chat.providers.openai.apiKey"]?.length ?? 0,
          });
          void bridge.openAgent(
            commandArg,
            modelForAgentLaunch,
            effectiveSettings,
          );
        }
        return;
      }
    }

    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    if (isAgent) {
      console.log("[ChatPanel:agent] handleSend settings:", {
        hasEffectiveSettings: !!effectiveSettings,
        openAiKeyLength: effectiveSettings?.["chat.providers.openai.apiKey"]?.length ?? 0,
        provider: selectedModel?.provider,
        modelId: selectedModel?.id,
      });
    }
    await chatService.sendMessage(trimmed, {
      mode: chatMode,
      settings: effectiveSettings,
    });
  };

  const handleStopGeneration = () => {
    chatService.stopGeneration();
  };

  const handleSelectSlashCommand = React.useCallback(
    (cmd: (typeof slashCommands)[number]) => {
      setInputValue(`/${cmd.name} `);
      setSlashMenuOpen(false);
      // Re-focus textarea on next tick to ensure focus returns after menu interaction
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    [slashCommands],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash command menu navigation
    if (slashMenuOpen && filteredSlashCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashMenuIndex((prev) =>
          prev < filteredSlashCommands.length - 1 ? prev + 1 : 0,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashMenuIndex((prev) =>
          prev > 0 ? prev - 1 : filteredSlashCommands.length - 1,
        );
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        handleSelectSlashCommand(filteredSlashCommands[slashMenuIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenuOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputValue(value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;

    // Slash command detection: show menu when the word at cursor starts with "/"
    const cursorPos = e.target.selectionStart ?? value.length;
    const textUpToCursor = value.slice(0, cursorPos);
    const slashMatch = textUpToCursor.match(/(?:^|\s)\/(\w*)$/);
    if (slashMatch) {
      const filter = slashMatch[1];
      const lower = filter.toLowerCase();
      const hasMatches =
        !filter || slashCommands.some((cmd) => cmd.name.startsWith(lower));
      if (hasMatches) {
        setSlashFilter(filter);
        setSlashMenuOpen(true);
        setSlashMenuIndex(0);
      } else {
        setSlashMenuOpen(false);
      }
    } else {
      setSlashMenuOpen(false);
    }
  };

  // Refocus textarea when slash menu closes to prevent focus loss
  React.useEffect(() => {
    if (!slashMenuOpen && textareaRef.current && inputValue.startsWith("/")) {
      textareaRef.current.focus();
    }
  }, [slashMenuOpen, inputValue]);

  // Close slash menu on click outside the input area
  React.useEffect(() => {
    if (!slashMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const inputArea = textareaRef.current?.closest(".relative");
      if (inputArea && !inputArea.contains(e.target as Node)) {
        setSlashMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [slashMenuOpen]);

  // Close history popup on click outside
  React.useEffect(() => {
    if (!showHistory) return;
    const onPointerDown = (e: PointerEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showHistory]);

  const handleNewChat = () => {
    const session = chatService.createSession();
    activeSessionIdRef.current = session.id;
    setActiveSession(session);
    setSessions([...chatService.sessions]);
    setChatMode(session.mode);
    setInputValue("");
    setStreamingText(null);
  };

  const handleSelectModel = (model: ChatModelInfo) => {
    console.log(
      "[ChatPanel] handleSelectModel:",
      model.provider,
      model.id,
      model.displayName,
    );
    setSelectedModel(model);
    chatService.currentModel = model;
    setShowModelPicker(false);
  };

  const handleDownloadModel = async (entry: LlamaModelEntry) => {
    setShowDownloadPanel(false);
    try {
      const installedModel = await llamaServerService.pullModel(
        entry.id,
        entry.quantization,
      );
      const models = await chatService.getInstalledModels();
      setInstalledModels(models);
      if (installedModel) {
        setSelectedModel(installedModel);
        chatService.currentModel = installedModel;
      }
    } catch (error) {
      if (error instanceof Error && /cancelled/i.test(error.message)) {
        return;
      }
      console.error("Download failed:", error);
    }
  };

  const handleFetchCatalog = async () => {
    setShowModelPicker(false);
    setShowDownloadPanel(true);
    try {
      const catalog = await fetchModelCatalog();
      setDownloadCatalog(catalog);
    } catch {
      setDownloadCatalog(LLAMA_MODEL_CATALOG_FALLBACK);
    }
  };

  const handleCancelDownload = async (modelId: string) => {
    try {
      await llamaServerService.cancelPullModel(modelId);
    } catch (error) {
      console.error("Failed to cancel download:", error);
    }
  };

  const getDownloadEntryName = React.useCallback(
    (modelId: string) =>
      downloadCatalog.find((entry) => entry.id === modelId)?.name ??
      modelId
        .split("/")
        .pop()
        ?.replace(/-GGUF$/i, "")
        .replace(/-/g, " ") ??
      modelId,
    [downloadCatalog],
  );

  const getDownloadMessage = React.useCallback((event: PullProgressEvent) => {
    if (typeof event.progress === "number" && event.phase === "downloading") {
      return `${event.message} · ${Math.round(event.progress)}%`;
    }
    return event.message;
  }, []);

  const messages = activeSession?.messages ?? [];
  const visibleStreamingText = streamingText;
  const activeDownloads = Array.from(downloadProgress.values());
  const toolMessagePairing = React.useMemo(
    () => buildToolMessagePairingIndex(messages),
    [messages],
  );

  return (
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-2xl border border-border-500 bg-panel ${className ?? ""}`}
    >
      {/* Agent header (minimal) */}
      {isAgent && (
        <div
          className="relative flex h-[38px] shrink-0 items-center justify-end border-b border-border-500 px-3"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 pointer-events-none">
            <Bot className="h-3.5 w-3.5 text-foreground-900" />
            <span className="text-xs font-semibold text-foreground">Agent</span>
          </div>
          {onClose && (
            <button
              className="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
              onClick={onClose}
              aria-label="Close agent"
              title="Close agent"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Tab bar (full variant only) */}
      {!isAgent && (
      <div className="flex h-[35px] shrink-0 items-center justify-between border-b border-border-500 px-1">
        <TinyScrollArea
          direction="horizontal"
          className="min-w-0 flex-1"
          contentClassName="flex items-center"
        >
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`group flex items-center gap-1 border-b-2 border-transparent bg-transparent pl-3 pr-1 text-xs text-foreground-900 transition-colors duration-150 hover:text-foreground ${session.id === activeSession?.id ? "!border-b-foreground font-semibold !text-foreground" : ""}`}
            >
              <button
                type="button"
                className="cursor-pointer whitespace-nowrap bg-transparent py-1.5 text-left"
                onClick={() => {
                  chatService.setActiveSession(session.id);
                  activeSessionIdRef.current = session.id;
                  setActiveSession(chatService.activeSession);
                  setStreamingText(null);
                }}
              >
                {session.title}
              </button>
              <button
                type="button"
                className={`rounded p-0.5 transition-colors hover:bg-border-500 hover:text-foreground ${session.id === activeSession?.id ? "text-foreground/50" : "text-transparent group-hover:text-foreground/35"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  chatService.closeSession(session.id);
                  setStreamingText(null);
                }}
                aria-label={`Close ${session.title}`}
                title={`Close ${session.title}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </TinyScrollArea>
        <div className="flex shrink-0 items-center gap-0.5 px-1">
          <button
            className="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground"
            onClick={handleNewChat}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            className="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground"
            onClick={() => setShowHistory((v) => !v)}
          >
            <Clock className="h-3.5 w-3.5" />
          </button>
          <button className="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      )}

      {/* History popup (full variant only) */}
      {!isAgent && showHistory && (
        <div
          ref={historyRef}
          className="absolute right-2 top-[40px] z-50 flex max-h-[320px] w-[280px] flex-col rounded-lg border border-border-500 bg-panel shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border-500 px-3 py-2">
            <span className="text-xs font-semibold text-foreground">History</span>
            <button
              className="flex size-5 cursor-pointer items-center justify-center rounded border-none bg-transparent text-foreground-900 hover:bg-border-500 hover:text-foreground"
              onClick={() => setShowHistory(false)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {chatService.historySessions.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-foreground-900">
                No past sessions
              </div>
            ) : (
              (() => {
                const today = new Date();
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);
                const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
                const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).getTime();

                let lastLabel = "";
                return chatService.historySessions.map((session) => {
                  const ts = session.closedAt!;
                  let label: string;
                  if (ts >= startOfToday) label = "Today";
                  else if (ts >= startOfYesterday) label = "Yesterday";
                  else label = new Date(ts).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

                  const showLabel = label !== lastLabel;
                  lastLabel = label;

                  return (
                    <React.Fragment key={session.id}>
                      {showLabel && (
                        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-foreground-900">
                          {label}
                        </div>
                      )}
                      <button
                        className="flex w-full cursor-pointer flex-col gap-0.5 border-none bg-transparent px-3 py-2 text-left hover:bg-border-500"
                        onClick={() => {
                          chatService.restoreSession(session.id);
                          activeSessionIdRef.current = session.id;
                          setActiveSession(chatService.activeSession);
                          setSessions([...chatService.sessions]);
                          setShowHistory(false);
                        }}
                      >
                        <span className="truncate text-xs font-medium text-foreground">
                          {session.title}
                        </span>
                        <span className="text-[10px] text-foreground-900">
                          {new Date(ts).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </button>
                    </React.Fragment>
                  );
                });
              })()
            )}
          </div>
        </div>
      )}

      {/* Input area at bottom */}
      <div className="order-2 flex shrink-0 flex-col gap-1 border-t border-border-500 px-3 py-2">
        <div className="relative box-border w-full cursor-text rounded-[10px] border border-border-500 bg-panel-600 px-1.5 pb-1.5 focus-within:border-sky">
          {/* Slash command autocomplete menu */}
          {slashMenuOpen && filteredSlashCommands.length > 0 && (
            <div className="absolute bottom-full left-0 z-[1000] mb-1 w-full min-w-[200px] overflow-hidden rounded-lg border border-border-500 bg-panel-600 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-placeholder">
                Commands
              </div>
              {filteredSlashCommands.map((cmd, idx) => {
                const Icon = cmd.icon;
                const isFocused = idx === slashMenuIndex;
                return (
                  <button
                    key={cmd.name}
                    className={`flex w-full cursor-pointer items-center gap-2.5 border-none px-2.5 py-2 text-left text-xs transition-colors ${isFocused ? "bg-sky/15 text-sky" : "bg-transparent text-foreground hover:bg-border-500"}`}
                    onMouseDown={(e) => {
                      e.preventDefault(); // prevent blur
                      handleSelectSlashCommand(cmd);
                    }}
                    onMouseEnter={() => setSlashMenuIndex(idx)}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${isFocused ? "text-sky" : "text-foreground-900"}`} />
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">/{cmd.name}</span>
                      <span className={`text-[11px] ${isFocused ? "text-sky/70" : "text-foreground-900"}`}>
                        {cmd.description}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
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
                      const rect =
                        modeButtonRef.current.getBoundingClientRect();
                      setModePickerPos({
                        top: rect.bottom + 4,
                        left: rect.left,
                      });
                    }
                    setShowModePicker(!showModePicker);
                  }}
                >
                  <span className="text-[10px] tracking-[-2px]">
                    &#8734;&#8734;
                  </span>
                  <span className="max-w-[120px] overflow-hidden text-ellipsis">
                    {chatMode}
                  </span>
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
                      const rect =
                        modelButtonRef.current.getBoundingClientRect();
                      setModelPickerPos({
                        top: rect.top - 8,
                        left: rect.left,
                      });
                    }
                    setShowModelPicker(!showModelPicker);
                  }}
                >
                  {isLoadingModel && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  <span className="max-w-[120px] overflow-hidden text-ellipsis">
                    {selectedModel?.displayName ?? "No model"}
                  </span>
                  <ChevronDown className="h-3 w-3" />
                </button>
                {showModelPicker && modelPickerPos && (
                  <div
                    className="fixed z-[1000] max-h-[300px] min-w-[220px] overflow-y-auto rounded-md border border-border-500 bg-panel-600 p-1 shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
                    style={{
                      top: modelPickerPos.top,
                      left: modelPickerPos.left,
                      transform: "translateY(-100%)",
                    }}
                  >
                    {installedModels.length > 0 ? (
                      <>
                        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-placeholder">
                          Local
                        </div>
                        {installedModels.map((model) => (
                          <button
                            key={model.id}
                            className={`flex w-full cursor-pointer items-center rounded px-2 py-1.5 border-none bg-transparent text-left text-xs text-foreground hover:bg-border-500 ${model.id === selectedModel?.id ? "bg-highlight text-sky" : ""}`}
                            onClick={() => handleSelectModel(model)}
                          >
                            <span>{model.displayName}</span>
                          </button>
                        ))}
                      </>
                    ) : null}
                    {remoteModels.length > 0 ? (
                      <>
                        {installedModels.length > 0 && (
                          <div className="my-1 h-px bg-border-500" />
                        )}
                        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-placeholder">
                          Frontier
                        </div>
                        {remoteModels.map((model) => (
                          <button
                            key={model.id}
                            className={`flex w-full cursor-pointer items-center rounded px-2 py-1.5 border-none bg-transparent text-left text-xs text-foreground hover:bg-border-500 ${model.id === selectedModel?.id ? "bg-highlight text-sky" : ""}`}
                            onClick={() => handleSelectModel(model)}
                          >
                            <span>{model.displayName}</span>
                          </button>
                        ))}
                      </>
                    ) : null}
                    {availableModels.length === 0 ? (
                      <div className="p-2 text-center text-xs text-placeholder">
                        No chat models available
                      </div>
                    ) : null}
                    {hasOpenAiConfigured && isLoadingOpenAiModels ? (
                      <div className="px-2 py-1 text-xs text-placeholder">
                        Loading OpenAI models...
                      </div>
                    ) : null}
                    {hasOpenAiConfigured &&
                    !isLoadingOpenAiModels &&
                    openAiModels.length === 0 ? (
                      <div className="px-2 py-1 text-xs text-placeholder">
                        No OpenAI chat models available for this API key.
                      </div>
                    ) : null}
                    <div className="my-1 h-px bg-border-500" />
                    <button
                      className="flex w-full cursor-pointer items-center rounded px-2 py-1.5 border-none bg-transparent text-left text-xs text-foreground hover:bg-border-500"
                      onClick={handleFetchCatalog}
                    >
                      <Download className="mr-2 h-3.5 w-3.5" />
                      Add Local Model...
                    </button>
                    {!hasGoogleGeminiConfigured && (
                      <button
                        className="flex w-full cursor-pointer items-center rounded px-2 py-1.5 border-none bg-transparent text-left text-xs text-foreground hover:bg-border-500"
                        onClick={() => {
                          setShowModelPicker(false);
                          Bus.emit("settings:open", undefined);
                        }}
                      >
                        Configure Google Gemini...
                      </button>
                    )}
                    {!hasAnthropicClaudeConfigured && (
                      <button
                        className="flex w-full cursor-pointer items-center rounded px-2 py-1.5 border-none bg-transparent text-left text-xs text-foreground hover:bg-border-500"
                        onClick={() => {
                          setShowModelPicker(false);
                          Bus.emit("settings:open", undefined);
                        }}
                      >
                        Configure Anthropic Claude...
                      </button>
                    )}
                    {!hasOpenAiConfigured && (
                      <button
                        className="flex w-full cursor-pointer items-center rounded px-2 py-1.5 border-none bg-transparent text-left text-xs text-foreground hover:bg-border-500"
                        onClick={() => {
                          setShowModelPicker(false);
                          Bus.emit("settings:open", undefined);
                        }}
                      >
                        Configure OpenAI...
                      </button>
                    )}
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
                {isStreaming ? (
                  <Square className="h-4 w-4 fill-current" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Scope selector */}
        <div className="py-0.5">
          <button className="flex cursor-pointer items-center gap-1 rounded border-none bg-transparent px-1.5 py-0.5 text-xs text-foreground-900 hover:text-foreground">
            <span className="text-sm">&#9633;</span>
            <span>
              {selectedModel
                ? getChatModelProviderLabel(selectedModel.provider)
                : "Local"}
            </span>
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="order-1 min-h-0 flex-1 overflow-y-auto text-foreground">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            {(!selectedModel || isLocalChatModel(selectedModel)) &&
              serverStatus !== "running" && (
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
                        await llamaServerService.startServer();
                        const models = await chatService.getInstalledModels();
                        setInstalledModels(models);
                        if (models.length > 0) {
                          setSelectedModel(models[0]);
                          chatService.currentModel = models[0];
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
                    <span className="text-foreground/40">
                      Starting server...
                    </span>
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
            {messages.map((msg, idx) => {
              if (
                msg.subtype === "tool_result" &&
                toolMessagePairing.pairedResultIds.has(msg.id)
              ) {
                return null;
              }

              const isToolMsg =
                msg.subtype === "tool_use" || msg.subtype === "tool_result";

              const nextVisible = messages
                .slice(idx + 1)
                .find(
                  (m) =>
                    !(
                      m.subtype === "tool_result" &&
                      toolMessagePairing.pairedResultIds.has(m.id)
                    ),
                );
              const isLastInTurn =
                !nextVisible || nextVisible.role === "user";
              let isLastToolInRun = false;
              if (isToolMsg) {
                const nextIsAlsoTool =
                  nextVisible?.subtype === "tool_use" ||
                  nextVisible?.subtype === "tool_result";
                isLastToolInRun = !nextIsAlsoTool && isLastInTurn;
              }

              if (msg.subtype === "tool_use") {
                const pairedResult =
                  toolMessagePairing.pairedResultByToolUseId.get(msg.id);
                if (pairedResult) {
                  return (
                    <ChatMessageItem
                      key={msg.id}
                      message={msg}
                      onOpenFileAtLine={onOpenFileAtLine}
                      pairedResult={pairedResult}
                      isLastTool={isLastToolInRun && !isStreaming}
                      isLast={isLastInTurn && !isStreaming}
                    />
                  );
                }
              }
              return (
                <ChatMessageItem
                  key={msg.id}
                  message={msg}
                  onOpenFileAtLine={onOpenFileAtLine}
                  isLastTool={isLastToolInRun && !isStreaming}
                  isLast={isLastInTurn && !isStreaming}
                />
              );
            })}
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

      <Modal
        open={showDownloadPanel}
        onClose={() => setShowDownloadPanel(false)}
        title="Choose a model to download"
        description="The downloader now opens in a centered modal so the chat stays visible. Active downloads continue in a small floating indicator."
        contentClassName="p-2"
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              className="cursor-pointer rounded-md border border-border-500 bg-transparent px-3 py-1.5 text-xs text-foreground hover:bg-border-500"
              onClick={() => setShowDownloadPanel(false)}
            >
              Close
            </button>
          </div>
        }
      >
        <div className="space-y-1">
          {downloadCatalog.map((entry) => {
            const dlState = downloadProgress.get(entry.id);
            const isActive =
              dlState &&
              dlState.phase !== "complete" &&
              dlState.phase !== "error" &&
              dlState.phase !== "cancelled";

            return (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-3 transition-colors hover:border-border-500 hover:bg-panel-400"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-center gap-1.5 text-[13px] text-foreground">
                    {entry.name}
                    {entry.recommended && (
                      <span className="rounded bg-highlight px-1.5 py-px text-[10px] text-sky">
                        Recommended
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-placeholder">
                    {entry.size} · {entry.description}
                  </span>
                  {dlState && (
                    <span className="truncate text-[11px] text-placeholder">
                      {getDownloadMessage(dlState)}
                    </span>
                  )}
                </div>
                {isActive ? (
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded border border-border-500 bg-transparent px-3 py-1 text-xs text-foreground hover:bg-border-500"
                    onClick={() => handleCancelDownload(entry.id)}
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
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
      </Modal>

      {activeDownloads.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[1200] flex justify-center px-4">
          <div className="pointer-events-auto flex w-full max-w-[420px] flex-col gap-2">
            {activeDownloads.map((event) => (
              <DownloadIndicator
                key={event.modelId}
                title={getDownloadEntryName(event.modelId)}
                message={getDownloadMessage(event)}
                tone={
                  event.phase === "error"
                    ? "error"
                    : event.phase === "complete"
                      ? "complete"
                      : event.phase === "cancelled"
                        ? "cancelled"
                        : "active"
                }
                onCancel={
                  event.canCancel
                    ? () => handleCancelDownload(event.modelId)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Footer usage indicator */}
      <div className="shrink-0 border-t border-border-500 px-4 py-2">
        <div className="flex items-center gap-1.5 text-xs text-placeholder">
          <span className="text-sm text-sky-700">&#9673;</span>
          <span>
            {selectedModel
              ? getChatModelProviderLabel(selectedModel.provider)
              : "No model selected"}
          </span>
        </div>
      </div>
    </div>
  );
}

const thinkingExpansionState = new Map<string, boolean>();

function MessageCursor() {
  return (
    <span className="animate-[chat-blink_0.8s_step-end_infinite] text-sky">
      |
    </span>
  );
}

function ThinkingBlock({
  messageId,
  index,
  content,
  isClosed,
  isStreaming,
}: {
  messageId: string;
  index: number;
  content: string;
  isClosed: boolean;
  isStreaming: boolean;
}) {
  const isActivelyStreaming = isStreaming && !isClosed;
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (isActivelyStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  const storageKey = `${messageId}:thinking:${index}`;
  const persistedExpanded = thinkingExpansionState.get(storageKey);
  const [expanded, setExpanded] = React.useState(
    persistedExpanded ?? (isStreaming || !isClosed),
  );

  React.useEffect(() => {
    thinkingExpansionState.set(storageKey, expanded);
  }, [expanded, storageKey]);

  return (
    <ThinkingTimelineRow isStreaming={isActivelyStreaming}>
      {expanded && content && (
        <div className="relative overflow-hidden rounded-lg border border-border-500/60 bg-panel-700 shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
          {isActivelyStreaming && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-6 bg-gradient-to-b from-panel-700 to-transparent" />
          )}
          <div
            ref={scrollRef}
            className="overflow-auto px-3 py-2"
            style={{ maxHeight: 160 }}
          >
            <MarkdownMessage content={content} variant="thinking" />
            {isActivelyStreaming && <MessageCursor />}
          </div>
          {!isActivelyStreaming && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-panel-700 to-transparent" />
          )}
          <button
            type="button"
            className="absolute right-1.5 top-1.5 z-[3] flex size-5 items-center justify-center rounded bg-panel-500/80 text-foreground/40 transition-colors hover:bg-panel-400 hover:text-foreground/70"
            onClick={() => {
              const next = !expanded;
              setExpanded(next);
              thinkingExpansionState.set(storageKey, next);
            }}
            aria-label="Collapse thinking"
          >
            <ChevronDown className="size-3 rotate-180" />
          </button>
        </div>
      )}
      {!expanded && content && (
        <button
          type="button"
          className="text-left text-[11px] text-foreground/40 truncate max-w-[400px] hover:text-foreground/60 transition-colors"
          onClick={() => {
            setExpanded(true);
            thinkingExpansionState.set(storageKey, true);
          }}
        >
          {content.replace(/\s+/g, " ").trim().slice(0, 120)}…
        </button>
      )}
    </ThinkingTimelineRow>
  );
}

function AssistantMessageContent({
  message,
  isNotice,
}: {
  message: ChatMessage;
  isNotice: boolean;
}) {
  const parsed = React.useMemo(
    () => parseAssistantRenderableContent(message.content),
    [message.content],
  );
  const textClassName = isNotice ? "text-foreground-900" : "";

  if (!parsed.hasThinking) {
    return (
      <div>
        <MarkdownMessage content={message.content} className={textClassName} />
        {message.isStreaming && <MessageCursor />}
      </div>
    );
  }

  return (
    <div>
      {parsed.segments.map((segment, index) =>
        segment.kind === "text" ? (
          segment.content ? (
            <MarkdownMessage
              key={`${message.id}:text:${index}`}
              content={segment.content}
              className={textClassName}
            />
          ) : null
        ) : (
          <ThinkingBlock
            key={`${message.id}:thinking:${index}`}
            messageId={message.id}
            index={index}
            content={segment.content}
            isClosed={segment.isClosed}
            isStreaming={Boolean(message.isStreaming)}
          />
        ),
      )}
      {message.isStreaming &&
        !parsed.segments.some(
          (segment) => segment.kind === "thinking" && !segment.isClosed,
        ) && <MessageCursor />}
    </div>
  );
}

function formatErrorMessage(content: string): string {
  return content.replace(/^Error:\s*/i, "").trim();
}

function ChatMessageItem({
  message,
  onOpenFileAtLine,
  pairedResult,
  isLastTool = false,
  isLast = false,
}: {
  message: ChatMessage;
  pairedResult?: ChatMessage;
  onOpenFileAtLine?: (path: string, line: number) => void | Promise<void>;
  isLastTool?: boolean;
  isLast?: boolean;
}) {
  const isUser = message.role === "user";
  const isErrorMessage = message.subtype === "error";
  const isNotice =
    message.role === "system" || message.subtype === "interruption";
  const isToolMessage =
    message.subtype === "tool_use" || message.subtype === "tool_result";
  const isAssistantText =
    !isUser && !isToolMessage && !isNotice && !isErrorMessage;

  return (
    <div
      className={`flex cursor-default select-text flex-col px-4 ${isUser ? "items-end py-1.5" : isToolMessage ? "py-0" : isAssistantText || isErrorMessage ? "py-0" : "py-1.5"}`}
    >
      <div
        className={`w-full ${isUser ? "ml-auto w-fit max-w-[90%] rounded-2xl bg-panel-400 px-3 py-2" : isNotice ? "rounded-xl border border-border-500 bg-panel-300 px-3 py-2" : isToolMessage ? "pl-0.5" : isAssistantText || isErrorMessage ? "pl-0.5" : ""}`}
      >
        {isToolMessage ? (
          <ToolMessageRenderer
            message={message}
            onOpenFileAtLine={onOpenFileAtLine}
            pairedResult={pairedResult}
            isLast={isLastTool}
          />
        ) : isErrorMessage ? (
          <ErrorTimelineRow
            message={formatErrorMessage(message.content)}
            isLast={isLast}
          />
        ) : message.isStreaming && !message.content ? (
          <WorkingTimelineRow text="Working..." isLast />
        ) : isAssistantText ? (
          <AssistantTimelineRow isLast={isLast}>
            <AssistantMessageContent message={message} isNotice={false} />
          </AssistantTimelineRow>
        ) : (
          <AssistantMessageContent message={message} isNotice={isNotice} />
        )}
      </div>
    </div>
  );
}
