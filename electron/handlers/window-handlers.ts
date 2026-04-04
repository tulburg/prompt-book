import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApplicationSettings } from "../../src/lib/application-settings";
import type { ChatModelInfo } from "../../src/lib/chat/chat-models";
import type { ChatSession } from "../../src/lib/chat-service";

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
  session?: ChatSession | null;
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
        session?: ChatSession | null;
      },
    ) => {
      const agentWin = new BrowserWindow({
        width: 520,
        height: 680,
        icon: path.join(VITE_PUBLIC, "electron-vite.svg"),
        title: "Agent",
        webPreferences: {
          preload: path.join(__dirname, "preload.mjs"),
        },
        titleBarStyle: "hiddenInset",
      });

      agentLaunchPayloads.set(agentWin.id, {
        prompt: payload.prompt,
        model: payload.session?.model ?? payload.model ?? null,
        settings: payload.settings ?? null,
        session: payload.session ?? null,
      });
      agentWin.on("closed", () => {
        agentLaunchPayloads.delete(agentWin.id);
      });

      // Load the same app but with a query param so the renderer knows it's an agent window
      const prompt = encodeURIComponent(payload.prompt);
      const model = payload.session?.model ?? payload.model;
      const modelParams = model
        ? `&modelId=${encodeURIComponent(model.id)}&modelProvider=${encodeURIComponent(model.provider)}&modelName=${encodeURIComponent(model.displayName)}`
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
            ...(model
              ? {
                  modelId: model.id,
                  modelProvider: model.provider,
                  modelName: model.displayName,
                }
              : {}),
          },
        });
      }

      return { windowId: agentWin.id };
    },
  );
}
