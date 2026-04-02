import { Menu, app, BrowserWindow, screen } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureLlamaServerStarted, registerAllHandlers, killLlamaServer, store } from "./handlers";

createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null;

function sendOpenSettingsEvent() {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? win;
  targetWindow?.webContents.send("app:open-settings");
}

function setApplicationMenu() {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [];

  if (isMac) {
    const appSubmenu: Electron.MenuItemConstructorOptions[] = [
      { role: "about" },
      {
        accelerator: "Command+,",
        click: () => sendOpenSettingsEvent(),
        label: "Settings...",
      },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ];

    template.push({
      label: app.name,
      submenu: appSubmenu,
    });
  }

  const fileSubmenu: Electron.MenuItemConstructorOptions[] = [
    ...(!isMac
      ? [
          {
            accelerator: "Ctrl+,",
            click: () => sendOpenSettingsEvent(),
            label: "Settings...",
          },
          { type: "separator" as const },
        ]
      : []),
    { role: isMac ? "close" : "quit" },
  ];

  const editSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: "undo" },
    { role: "redo" },
    { type: "separator" },
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "selectAll" },
  ];

  const viewSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: "reload" },
    { role: "forceReload" },
    { role: "toggleDevTools" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];

  const windowSubmenu: Electron.MenuItemConstructorOptions[] = [
    { role: "minimize" },
    { role: "zoom" },
    ...(isMac
      ? [{ type: "separator" as const }, { role: "front" as const }]
      : [{ role: "close" as const }]),
  ];

  template.push(
    {
      label: "File",
      submenu: fileSubmenu,
    },
    {
      label: "Edit",
      submenu: editSubmenu,
    },
    {
      label: "View",
      submenu: viewSubmenu,
    },
    {
      label: "Window",
      submenu: windowSubmenu,
    },
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isValidPosition(x: number, y: number): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((display) => {
    const { x: dx, y: dy, width, height } = display.workArea;
    return x >= dx && x <= dx + width && y >= dy && y <= dy + height;
  });
}

function saveWindowState() {
  if (win) {
    const bounds = win.getBounds();
    store.set("windowState", {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
    });
  }
}

function createWindow() {
  const savedState = store.get("windowState");

  const options: Electron.BrowserWindowConstructorOptions = {
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
    width: savedState.width,
    height: savedState.height,
    titleBarStyle: "hiddenInset",
  };

  if (savedState.x !== undefined && savedState.y !== undefined) {
    const position = isValidPosition(savedState.x, savedState.y);
    if (position) {
      options.x = savedState.x;
      options.y = savedState.y;
    } else {
      const center = screen.getPrimaryDisplay().workAreaSize;
      options.x = (center.width - options.width!) / 2;
      options.y = (center.height - options.height!) / 2;
    }
  }

  win = new BrowserWindow(options);
  if (savedState.isMaximized) {
    win.maximize();
  }

  win.on("resize", () => {
    if (!win) return;
    const bounds = win.getBounds();
    store.set("windowState", {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
    });
  });

  win.on("move", () => {
    if (!win) return;
    const bounds = win.getBounds();
    store.set("windowState", {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
    });
  });

  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

app.on("before-quit", () => {
  saveWindowState();
  killLlamaServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    saveWindowState();
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  setApplicationMenu();
  registerAllHandlers(win);
  void ensureLlamaServerStarted().catch((error) => {
    console.error("[LlamaServer] Failed to start on app launch:", error);
  });
  createWindow();
});
