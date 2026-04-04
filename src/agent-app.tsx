import { ChatPanel } from "@/ui";
import type { ChatModelInfo } from "@/lib/chat/chat-models";

/**
 * AgentApp is the root component rendered in agent OS windows.
 * It reuses ChatPanel with variant="agent" — no tabs, no sidebar, no editor,
 * just a clean chat interface that auto-sends the initial prompt.
 */
export default function AgentApp() {
  const params = new URLSearchParams(window.location.search);
  const initialPrompt = params.get("prompt") ?? "";
  const initialModelId = params.get("modelId") ?? undefined;
  const initialModelProvider = params.get("modelProvider");
  const initialModelName = params.get("modelName");
  const initialModel: ChatModelInfo | undefined =
    initialModelId && initialModelProvider && initialModelName
      ? {
          id: initialModelId,
          provider: initialModelProvider as ChatModelInfo["provider"],
          displayName: initialModelName,
        }
      : undefined;

  const handleClose = () => {
    window.close();
  };

  return (
    <div className="bg-panel flex h-screen w-screen flex-col">
      <ChatPanel
        variant="agent"
        initialPrompt={initialPrompt}
        initialModelId={initialModelId}
        initialModel={initialModel}
        onClose={handleClose}
        className="h-full rounded-none border-none"
      />
    </div>
  );
}
