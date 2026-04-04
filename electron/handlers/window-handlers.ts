import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, "../..");
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(APP_ROOT, "public")
  : RENDERER_DIST;

export function registerWindowHandlers() {
  ipcMain.handle(
    "window:open-agent",
    async (_event, payload: { prompt: string; modelId?: string }) => {
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

      // Load the same app but with a query param so the renderer knows it's an agent window
      const prompt = encodeURIComponent(payload.prompt);
      const modelParam = payload.modelId
        ? `&modelId=${encodeURIComponent(payload.modelId)}`
        : "";
      if (VITE_DEV_SERVER_URL) {
        await agentWin.loadURL(
          `${VITE_DEV_SERVER_URL}?agent=1&prompt=${prompt}${modelParam}`,
        );
      } else {
        await agentWin.loadFile(path.join(RENDERER_DIST, "index.html"), {
          query: {
            agent: "1",
            prompt: payload.prompt,
            ...(payload.modelId ? { modelId: payload.modelId } : {}),
          },
        });
      }

      return { windowId: agentWin.id };
    },
  );
}
