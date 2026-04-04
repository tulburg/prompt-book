import { ChatPanel } from "@/ui";

/**
 * AgentApp is the root component rendered in agent OS windows.
 * It reuses ChatPanel with variant="agent" — no tabs, no sidebar, no editor,
 * just a clean chat interface that auto-sends the initial prompt.
 */
export default function AgentApp() {
  const params = new URLSearchParams(window.location.search);
  const initialPrompt = params.get("prompt") ?? "";
  const initialModelId = params.get("modelId") ?? undefined;

  const handleClose = () => {
    window.close();
  };

  return (
    <div className="bg-panel flex h-screen w-screen flex-col">
      <ChatPanel
        variant="agent"
        initialPrompt={initialPrompt}
        initialModelId={initialModelId}
        onClose={handleClose}
        className="h-full rounded-none border-none"
      />
    </div>
  );
}
