import { app, BrowserWindow, dialog, ipcMain, screen } from "electron";
import Store from "electron-store";
import { constants as fsConstants, promises as fs } from "node:fs";
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
    lastProjectPath: null,
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

interface ProjectPermissions {
  read: boolean;
  write: boolean;
  status: "granted" | "partial" | "denied";
  message?: string;
}

interface ProjectNode {
  path: string;
  name: string;
  kind: "file" | "directory";
  permissions: ProjectPermissions;
  size?: number;
  modifiedAt?: number;
  children?: ProjectNode[];
}

interface ProjectSnapshot {
  rootPath: string;
  rootName: string;
  source: "electron";
  permissions: ProjectPermissions;
  tree: ProjectNode;
}

async function getPermissions(targetPath: string): Promise<ProjectPermissions> {
  let canRead = true;
  let canWrite = true;

  try {
    await fs.access(targetPath, fsConstants.R_OK);
  } catch {
    canRead = false;
  }

  try {
    await fs.access(targetPath, fsConstants.W_OK);
  } catch {
    canWrite = false;
  }

  if (canRead && canWrite) {
    return {
      read: true,
      write: true,
      status: "granted",
    };
  }

  if (canRead || canWrite) {
    return {
      read: canRead,
      write: canWrite,
      status: "partial",
      message: "This item is only partially accessible with current permissions.",
    };
  }

  return {
    read: false,
    write: false,
    status: "denied",
    message: "This item is not accessible with current permissions.",
  };
}

async function buildProjectNode(targetPath: string): Promise<ProjectNode> {
  const stats = await fs.stat(targetPath);
  const permissions = await getPermissions(targetPath);
  const kind = stats.isDirectory() ? "directory" : "file";

  if (kind === "file") {
    return {
      path: targetPath,
      name: path.basename(targetPath),
      kind,
      permissions,
      modifiedAt: stats.mtimeMs,
      size: stats.size,
    };
  }

  const children: ProjectNode[] = [];
  if (permissions.read) {
    const entries = await fs.readdir(targetPath);
    const sortedEntries = entries.sort((left, right) =>
      left.localeCompare(right),
    );

    for (const entry of sortedEntries) {
      const entryPath = path.join(targetPath, entry);
      try {
        children.push(await buildProjectNode(entryPath));
      } catch {
        // Skip entries that become unavailable while refreshing the tree.
      }
    }
  }

  children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  return {
    path: targetPath,
    name: path.basename(targetPath),
    kind,
    permissions,
    modifiedAt: stats.mtimeMs,
    children,
  };
}

async function buildProjectSnapshot(rootPath: string): Promise<ProjectSnapshot> {
  const tree = await buildProjectNode(rootPath);
  if (tree.kind !== "directory") {
    throw new Error("Projects must start from a folder.");
  }

  return {
    rootPath,
    rootName: path.basename(rootPath),
    source: "electron",
    permissions: await getPermissions(rootPath),
    tree,
  };
}

async function ensureWritable(targetPath: string, message: string) {
  const permissions = await getPermissions(targetPath);
  if (!permissions.write) {
    throw new Error(message);
  }
}

async function ensurePathExists(targetPath: string) {
  try {
    await fs.access(targetPath, fsConstants.F_OK);
  } catch {
    throw new Error(`Path does not exist: ${targetPath}`);
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

ipcMain.handle("project:restore-last", async () => {
  const lastProjectPath = store.get("lastProjectPath");
  if (typeof lastProjectPath !== "string" || !lastProjectPath) {
    return null;
  }

  try {
    await ensurePathExists(lastProjectPath);
    return await buildProjectSnapshot(lastProjectPath);
  } catch {
    store.set("lastProjectPath", null);
    return null;
  }
});

ipcMain.handle("project:open-folder", async () => {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? win ?? undefined;
  const result = await dialog.showOpenDialog(targetWindow, {
    properties: ["openDirectory"],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const rootPath = result.filePaths[0];
  store.set("lastProjectPath", rootPath);
  return buildProjectSnapshot(rootPath);
});

ipcMain.handle("project:refresh", async (_event, rootPath: string) => {
  await ensurePathExists(rootPath);
  store.set("lastProjectPath", rootPath);
  return buildProjectSnapshot(rootPath);
});

ipcMain.handle("project:read-file", async (_event, filePath: string) => {
  await ensurePathExists(filePath);
  const permissions = await getPermissions(filePath);
  if (!permissions.read) {
    throw new Error("You do not have permission to read this file.");
  }

  return {
    content: await fs.readFile(filePath, "utf8"),
    permissions,
  };
});

ipcMain.handle(
  "project:write-file",
  async (_event, filePath: string, content: string) => {
    await ensurePathExists(filePath);
    await ensureWritable(filePath, "You do not have permission to edit this file.");
    await fs.writeFile(filePath, content, "utf8");
    return {
      permissions: await getPermissions(filePath),
    };
  },
);

ipcMain.handle(
  "project:create-file",
  async (_event, parentPath: string, name: string, content = "") => {
    await ensurePathExists(parentPath);
    await ensureWritable(
      parentPath,
      "You do not have permission to create files in this folder.",
    );

    const targetPath = path.join(parentPath, name);
    await fs.writeFile(targetPath, content, { encoding: "utf8", flag: "wx" });

    const rootPath = store.get("lastProjectPath");
    return buildProjectSnapshot(
      typeof rootPath === "string" && rootPath ? rootPath : parentPath,
    );
  },
);

ipcMain.handle("project:create-folder", async (_event, parentPath: string, name: string) => {
  await ensurePathExists(parentPath);
  await ensureWritable(
    parentPath,
    "You do not have permission to create folders in this location.",
  );

  const targetPath = path.join(parentPath, name);
  await fs.mkdir(targetPath, { recursive: false });

  const rootPath = store.get("lastProjectPath");
  return buildProjectSnapshot(
    typeof rootPath === "string" && rootPath ? rootPath : parentPath,
  );
});

ipcMain.handle("project:rename-path", async (_event, targetPath: string, nextName: string) => {
  await ensurePathExists(targetPath);
  const parentPath = path.dirname(targetPath);
  await ensureWritable(
    parentPath,
    "You do not have permission to rename items in this location.",
  );

  const renamedPath = path.join(parentPath, nextName);
  await fs.rename(targetPath, renamedPath);

  const rootPath = store.get("lastProjectPath");
  return buildProjectSnapshot(
    typeof rootPath === "string" && rootPath ? rootPath : parentPath,
  );
});

ipcMain.handle("project:delete-path", async (_event, targetPath: string) => {
  await ensurePathExists(targetPath);
  const parentPath = path.dirname(targetPath);
  await ensureWritable(
    parentPath,
    "You do not have permission to delete items from this location.",
  );

  await fs.rm(targetPath, { recursive: true, force: false });

  const rootPath = store.get("lastProjectPath");
  return buildProjectSnapshot(
    typeof rootPath === "string" && rootPath ? rootPath : parentPath,
  );
});

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
