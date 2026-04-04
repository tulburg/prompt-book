import { ChatPanel } from "@/ui";
import type { ApplicationSettings } from "@/lib/application-settings";
import type { ChatModelInfo } from "@/lib/chat/chat-models";
import * as React from "react";

type AgentLaunchContext = {
  prompt: string;
  model?: ChatModelInfo | null;
  settings?: ApplicationSettings | null;
};

/**
 * AgentApp is the root component rendered in agent OS windows.
 * It reuses ChatPanel with variant="agent" — no tabs, no sidebar, no editor,
 * just a clean chat interface that auto-sends the initial prompt.
 */
export default function AgentApp() {
  const params = new URLSearchParams(window.location.search);
  const queryPrompt = params.get("prompt") ?? "";
  const queryModelId = params.get("modelId") ?? undefined;
  const initialModelProvider = params.get("modelProvider");
  const initialModelName = params.get("modelName");
  const queryModel = React.useMemo<ChatModelInfo | undefined>(
    () =>
      queryModelId && initialModelProvider && initialModelName
        ? {
            id: queryModelId,
            provider: initialModelProvider as ChatModelInfo["provider"],
            displayName: initialModelName,
          }
        : undefined,
    [queryModelId, initialModelProvider, initialModelName],
  );
  const [launchContext, setLaunchContext] = React.useState<{
    isReady: boolean;
    prompt: string;
    model?: ChatModelInfo | null;
    settings?: ApplicationSettings | null;
  }>(() => ({
    isReady: !window.windowBridge?.getAgentLaunchContext,
    prompt: queryPrompt,
    model: queryModel,
    settings: null,
  }));

  React.useEffect(() => {
    const bridge = window.windowBridge;
    if (!bridge?.getAgentLaunchContext) {
      return;
    }

    let cancelled = false;
    void bridge
      .getAgentLaunchContext()
      .then((context) => {
        if (cancelled) return;
        console.log("[AgentApp] launch context received:", {
          hasContext: !!context,
          hasSettings: !!context?.settings,
          hasOpenAiKey: !!context?.settings?.["chat.providers.openai.apiKey"],
          openAiKeyLength: context?.settings?.["chat.providers.openai.apiKey"]?.length ?? 0,
        });
        setLaunchContext({
          isReady: true,
          prompt: context?.prompt ?? queryPrompt,
          model: context?.model ?? queryModel,
          settings: context?.settings ?? null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLaunchContext((current) => ({ ...current, isReady: true }));
      });

    return () => {
      cancelled = true;
    };
  }, [queryModel, queryPrompt]);

  const initialPrompt = launchContext.prompt;
  const initialModel = launchContext.model ?? undefined;
  const initialModelId = initialModel?.id ?? queryModelId;

  const handleClose = () => {
    window.close();
  };

  if (!launchContext.isReady) {
    return <div className="bg-panel h-screen w-screen" />;
  }

  return (
    <div className="bg-panel flex h-screen w-screen flex-col">
      <ChatPanel
        variant="agent"
        initialPrompt={initialPrompt}
        initialModelId={initialModelId}
        initialModel={initialModel}
        initialSettings={launchContext.settings}
        onClose={handleClose}
        className="h-full rounded-none border-none"
      />
    </div>
  );
}
