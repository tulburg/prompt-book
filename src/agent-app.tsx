import {
  type ChatMessage,
  type ChatSession,
  chatService,
} from "@/lib/chat-service";
import { useApplicationSettings } from "@/lib/use-application-settings";
import { parseAssistantRenderableContent } from "@/lib/chat/render-message-content";
import { handleChatStreamEvent } from "@/lib/chat/stream-events";
import {
  ErrorTimelineRow,
  ToolMessageRenderer,
  WorkingTimelineRow,
  AssistantTimelineRow,
} from "@/lib/chat/tools/renderers/ToolMessageRenderer";
import { buildToolMessagePairingIndex } from "@/ui/higher/tool-message-pairing";
import { MarkdownMessage } from "@/ui/higher/MarkdownMessage";
import { Mic, Square } from "lucide-react";
import * as React from "react";

/**
 * AgentApp is the root component rendered in agent OS windows.
 * It hosts a single chat session with no tabs, no sidebar, no editor —
 * just a clean chat interface that auto-sends the initial prompt.
 */
export default function AgentApp() {
  const params = new URLSearchParams(window.location.search);
  const initialPrompt = params.get("prompt") ?? "";

  const { settings } = useApplicationSettings();
  const [session, setSession] = React.useState<ChatSession | null>(null);
  const [inputValue, setInputValue] = React.useState("");
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [streamingText, setStreamingText] = React.useState<string | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = React.useRef<string | null>(null);
  const sentInitialRef = React.useRef(false);

  // Create a dedicated session for this agent window
  React.useEffect(() => {
    const agentSession = chatService.createSession("Agent");
    sessionIdRef.current = agentSession.id;
    setSession(agentSession);

    const unsubSession = chatService.onDidUpdateSession(() => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const snap = chatService.sessions.find((s) => s.id === sid) ?? null;
      if (snap) {
        setSession({ ...snap });
        setIsStreaming(chatService.streamingSessionId === sid);
      }
    });

    const unsubStream = chatService.onDidStreamEvent((event) => {
      if (event.sessionId !== sessionIdRef.current) return;
      handleChatStreamEvent(event, {
        onMessage: () => {},
        onSetStreamMode: (mode) => {
          setIsStreaming(mode !== "idle");
        },
        onStreamingText: (updater) => {
          setStreamingText(updater);
        },
      });
    });

    return () => {
      unsubSession();
      unsubStream();
    };
  }, []);

  // Send initial prompt once session is ready
  React.useEffect(() => {
    if (!session || sentInitialRef.current || !initialPrompt.trim()) return;
    sentInitialRef.current = true;

    chatService.setActiveSession(session.id);
    void chatService.sendMessage(initialPrompt.trim(), {
      mode: "Agent",
      settings,
    });
  }, [session, initialPrompt, settings]);

  // Auto-scroll
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages, streamingText, isStreaming]);

  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;

    setInputValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    if (sessionIdRef.current) {
      chatService.setActiveSession(sessionIdRef.current);
    }
    await chatService.sendMessage(trimmed, { mode: "Agent", settings });
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

  const messages = session?.messages ?? [];
  const toolMessagePairing = React.useMemo(
    () => buildToolMessagePairingIndex(messages),
    [messages],
  );

  return (
    <div className="bg-panel flex h-screen w-screen flex-col">
      {/* Draggable title bar region (for hiddenInset titleBarStyle) */}
      <div
        className="flex h-[38px] shrink-0 items-center px-[80px] text-xs font-medium text-foreground-900"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        Agent
      </div>

      {/* Messages area */}
      <div className="min-h-0 flex-1 overflow-y-auto text-foreground">
        {messages.length === 0 && !isStreaming ? (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-placeholder">
              {initialPrompt ? "Starting..." : "Send a message to begin"}
            </span>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[700px] flex-col pb-4">
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

              return (
                <AgentMessageItem
                  key={msg.id}
                  message={msg}
                  pairedResult={
                    msg.subtype === "tool_use"
                      ? toolMessagePairing.pairedResultByToolUseId.get(msg.id)
                      : undefined
                  }
                  isLastTool={isLastToolInRun && !isStreaming}
                  isLast={isLastInTurn && !isStreaming}
                />
              );
            })}
            {isStreaming && (
              <AgentMessageItem
                message={{
                  id: "streaming-preview",
                  role: "assistant",
                  content: streamingText ?? "",
                  timestamp: Date.now(),
                  isStreaming: true,
                  subtype: "message",
                }}
                isLast={false}
                isLastTool={false}
              />
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-border-500 px-3 py-2">
        <div className="relative box-border w-full cursor-text rounded-[10px] border border-border-500 bg-panel-600 px-1.5 pb-1.5 focus-within:border-sky">
          <textarea
            ref={textareaRef}
            className="w-full min-h-[48px] max-h-[180px] resize-none border-none bg-transparent px-1.5 pt-2.5 pb-1 text-[13px] font-[inherit] leading-relaxed text-foreground outline-none placeholder:text-placeholder"
            placeholder="Send a message..."
            value={inputValue}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
            rows={2}
          />
          <div className="flex items-center justify-end gap-1 pt-0.5">
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
    </div>
  );
}

/* ─── Message renderer for agent window ─── */

function AgentMessageItem({
  message,
  pairedResult,
  isLastTool,
  isLast,
}: {
  message: ChatMessage;
  pairedResult?: ChatMessage;
  isLastTool: boolean;
  isLast: boolean;
}) {
  if (message.subtype === "tool_use" || message.subtype === "tool_result") {
    return (
      <div className="px-4 py-0">
        <ToolMessageRenderer
          message={message}
          pairedResult={pairedResult}
          isLast={isLastTool}
        />
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex cursor-default select-text flex-col items-end px-4 py-1.5">
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-panel-400 px-3 py-2">
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  if (message.role === "assistant") {
    if (!message.content && message.isStreaming) {
      return (
        <div className="px-4 py-0">
          <WorkingTimelineRow text="Working..." isLast />
        </div>
      );
    }

    const parsed = parseAssistantRenderableContent(message.content);
    return (
      <div className="px-4 py-0">
        <AssistantTimelineRow isLast={isLast}>
          {parsed.segments.map((segment, i) => {
            if (segment.kind === "thinking") {
              return null;
            }
            if (segment.kind === "text") {
              return <MarkdownMessage key={i} content={segment.content} />;
            }
            return null;
          })}
          {message.isStreaming && (
            <span className="animate-[chat-blink_0.8s_step-end_infinite] text-sky">
              |
            </span>
          )}
        </AssistantTimelineRow>
      </div>
    );
  }

  if (message.subtype === "error") {
    return <ErrorTimelineRow message={message.content} isLast={isLast} />;
  }

  return null;
}
