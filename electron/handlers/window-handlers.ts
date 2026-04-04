import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApplicationSettings } from "../../src/lib/application-settings";
import type { ChatModelInfo } from "../../src/lib/chat/chat-models";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, "../..");
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(APP_ROOT, "public")
  : RENDERER_DIST;

type AgentLaunchPayload = {
  prompt: string;
  model?: ChatModelInfo | null;
  settings?: ApplicationSettings | null;
};

const agentLaunchPayloads = new Map<number, AgentLaunchPayload>();

export function registerWindowHandlers() {
  ipcMain.handle("window:get-agent-launch-context", (event) => {
    const agentWindow = BrowserWindow.fromWebContents(event.sender);
    if (!agentWindow) {
      return null;
    }
    return agentLaunchPayloads.get(agentWindow.id) ?? null;
  });

  ipcMain.handle(
    "window:open-agent",
    async (
      _event,
      payload: {
        prompt: string;
        model?: ChatModelInfo | null;
        settings?: ApplicationSettings | null;
      },
    ) => {
      const agentWin = new BrowserWindow({
        width: 520,
        height: 680,
        icon: path.join(VITE_PUBLIC, "electron-vite.svg"),
        title: "Agent",
        webPreferences: {
          preload: path.join(__dirname, "../preload.mjs"),
        },
        titleBarStyle: "hiddenInset",
      });

      agentLaunchPayloads.set(agentWin.id, {
        prompt: payload.prompt,
        model: payload.model ?? null,
        settings: payload.settings ?? null,
      });
      agentWin.on("closed", () => {
        agentLaunchPayloads.delete(agentWin.id);
      });

      // Load the same app but with a query param so the renderer knows it's an agent window
      const prompt = encodeURIComponent(payload.prompt);
      const modelParams = payload.model
        ? `&modelId=${encodeURIComponent(payload.model.id)}&modelProvider=${encodeURIComponent(payload.model.provider)}&modelName=${encodeURIComponent(payload.model.displayName)}`
        : "";
      if (VITE_DEV_SERVER_URL) {
        await agentWin.loadURL(
          `${VITE_DEV_SERVER_URL}?agent=1&prompt=${prompt}${modelParams}`,
        );
      } else {
        await agentWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
          query: {
            agent: "1",
            prompt: payload.prompt,
            ...(payload.model
              ? {
                  modelId: payload.model.id,
                  modelProvider: payload.model.provider,
                  modelName: payload.model.displayName,
                }
              : {}),
          },
        });
      }

      return { windowId: agentWin.id };
    },
  );
}
