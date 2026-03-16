import { app, BrowserWindow, screen } from "electron";
import Store from "electron-store";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

// Store for window state persistence
const store = new Store({
  defaults: {
    windowState: {
      width: 1024,
      height: 768,
      x: undefined,
      y: undefined,
      isMaximized: false,
    },
  },
});

let win: BrowserWindow | null;
let isQuitting = false;

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

  // Restore position if saved and still visible
  if (savedState.x !== undefined && savedState.y !== undefined) {
    const position = isValidPosition(savedState.x, savedState.y);
    if (position) {
      options.x = savedState.x;
      options.y = savedState.y;
    } else {
      // Position centered if out of screen bounds
      const center = screen.getPrimaryDisplay().workAreaSize;
      options.x = (center.width - options.width!) / 2;
      options.y = (center.height - options.height!) / 2;
    }
  }

  // Restore maximized state
  if (savedState.isMaximized) {
    options.maximized = true;
  }

  win = new BrowserWindow(options);

  // Save window state before close
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

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}

// Check if position is within any visible display
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

// Save window state before quitting
app.on("before-quit", () => {
  saveWindowState();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    saveWindowState();
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);
