import { Menu, app, BrowserWindow, dialog, ipcMain, screen } from "electron";
import Store from "electron-store";
import { constants as fsConstants, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { NativeContextMenuRequest } from "../src/lib/native-context-menu";

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
    lastProjectPaths: [] as string[],
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
  parentPath: string | null;
  rootPath: string;
  permissions: ProjectPermissions;
  size?: number;
  modifiedAt?: number;
  childCount?: number;
  children?: ProjectNode[];
  isDirectoryResolved?: boolean;
  isLoading?: boolean;
}

interface ProjectSnapshot {
  source: "electron";
  roots: ProjectNode[];
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

async function buildProjectNode(
  targetPath: string,
  parentPath: string | null,
  rootPath: string,
): Promise<ProjectNode> {
  const stats = await fs.stat(targetPath);
  const permissions = await getPermissions(targetPath);
  const kind = stats.isDirectory() ? "directory" : "file";

  if (kind === "file") {
    return {
      path: targetPath,
      name: path.basename(targetPath),
      kind,
      parentPath,
      rootPath,
      permissions,
      modifiedAt: stats.mtimeMs,
      size: stats.size,
    };
  }

  return {
    path: targetPath,
    name: path.basename(targetPath),
    kind,
    parentPath,
    rootPath,
    permissions,
    modifiedAt: stats.mtimeMs,
    isDirectoryResolved: false,
  };
}

function dedupeRootPaths(rootPaths: string[]) {
  return [...new Set(rootPaths)];
}

async function buildProjectSnapshot(rootPaths: string[]): Promise<ProjectSnapshot> {
  const roots: ProjectNode[] = [];
  for (const rootPath of dedupeRootPaths(rootPaths)) {
    const rootNode = await buildProjectNode(rootPath, null, rootPath);
    if (rootNode.kind !== "directory") {
      throw new Error("Projects must start from a folder.");
    }
    roots.push(rootNode);
  }

  return {
    source: "electron",
    roots,
  };
}

function sortNodes(left: ProjectNode, right: ProjectNode) {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

function getStoredRootPaths() {
  const storedValue = store.get("lastProjectPaths");
  if (!Array.isArray(storedValue)) {
    return [];
  }

  return storedValue.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function setStoredRootPaths(rootPaths: string[]) {
  store.set("lastProjectPaths", dedupeRootPaths(rootPaths));
}

function findRootPath(targetPath: string, rootPaths: string[]) {
  return rootPaths
    .slice()
    .sort((left, right) => right.length - left.length)
    .find((rootPath) => targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`));
}

async function listDirectoryChildren(directoryPath: string, rootPath: string): Promise<ProjectNode[]> {
  const entries = await fs.readdir(directoryPath);
  const children = await Promise.all(
    entries
      .sort((left, right) => left.localeCompare(right))
      .map(async (entry) => buildProjectNode(path.join(directoryPath, entry), directoryPath, rootPath)),
  );
  return children.sort(sortNodes);
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

  win = new BrowserWindow(options);
  if (savedState.isMaximized) {
    win.maximize();
  }

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
  const rootPaths = getStoredRootPaths();
  if (rootPaths.length === 0) {
    return null;
  }

  try {
    const validRootPaths: string[] = [];
    for (const rootPath of rootPaths) {
      try {
        await ensurePathExists(rootPath);
        validRootPaths.push(rootPath);
      } catch {
        // Skip missing roots and clean them up below.
      }
    }

    if (validRootPaths.length === 0) {
      setStoredRootPaths([]);
      return null;
    }

    setStoredRootPaths(validRootPaths);
    return await buildProjectSnapshot(validRootPaths);
  } catch {
    setStoredRootPaths([]);
    return null;
  }
});

ipcMain.handle("project:open-folder", async () => {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? win ?? undefined;
  const result = targetWindow
    ? await dialog.showOpenDialog(targetWindow, {
        properties: ["openDirectory", "multiSelections"],
      })
    : await dialog.showOpenDialog({
        properties: ["openDirectory", "multiSelections"],
      });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const nextRootPaths = dedupeRootPaths([
    ...getStoredRootPaths(),
    ...result.filePaths,
  ]);
  setStoredRootPaths(nextRootPaths);
  return buildProjectSnapshot(nextRootPaths);
});

 ipcMain.handle("project:refresh", async () => {
  const rootPaths = getStoredRootPaths();
  for (const rootPath of rootPaths) {
    await ensurePathExists(rootPath);
  }
  setStoredRootPaths(rootPaths);
  return buildProjectSnapshot(rootPaths);
});

ipcMain.handle("project:list-directory", async (_event, directoryPath: string) => {
  await ensurePathExists(directoryPath);
  const rootPath = findRootPath(directoryPath, getStoredRootPaths());
  if (!rootPath) {
    throw new Error(`No workspace root found for: ${directoryPath}`);
  }

  const permissions = await getPermissions(directoryPath);
  if (!permissions.read) {
    throw new Error("You do not have permission to read this folder.");
  }

  const stats = await fs.stat(directoryPath);
  return {
    path: directoryPath,
    children: await listDirectoryChildren(directoryPath, rootPath),
    permissions,
    modifiedAt: stats.mtimeMs,
  };
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
    const rootPath = findRootPath(parentPath, getStoredRootPaths());
    if (!rootPath) {
      throw new Error(`No workspace root found for: ${parentPath}`);
    }
    return {
      parentPath,
      node: await buildProjectNode(targetPath, parentPath, rootPath),
    };
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
  const rootPath = findRootPath(parentPath, getStoredRootPaths());
  if (!rootPath) {
    throw new Error(`No workspace root found for: ${parentPath}`);
  }
  return {
    parentPath,
    node: await buildProjectNode(targetPath, parentPath, rootPath),
  };
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
  const rootPath = findRootPath(parentPath, getStoredRootPaths());
  if (!rootPath) {
    throw new Error(`No workspace root found for: ${parentPath}`);
  }
  return {
    oldPath: targetPath,
    parentPath,
    node: await buildProjectNode(renamedPath, parentPath, rootPath),
  };
});

ipcMain.handle("project:delete-path", async (_event, targetPath: string) => {
  await ensurePathExists(targetPath);
  const parentPath = path.dirname(targetPath);
  await ensureWritable(
    parentPath,
    "You do not have permission to delete items from this location.",
  );

  await fs.rm(targetPath, { recursive: true, force: false });
  return {
    deletedPath: targetPath,
    parentPath,
  };
});

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

function parseGitStatusCode(x: string, y: string): string {
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
    return "conflict";
  }
  if (x === "?" && y === "?") return "untracked";
  if (x === "!" && y === "!") return "ignored";
  if (x === "D" || y === "D") return "deleted";
  if (x === "R" || y === "R") return "renamed";
  if (x === "A" || y === "A") return "added";
  if (x === "M" || y === "M") return "modified";
  return "modified";
}

ipcMain.handle("git:status", async (_event, rootPath: string) => {
  try {
    await fs.access(path.join(rootPath, ".git"), fsConstants.F_OK);
  } catch {
    return null;
  }

  try {
    const raw = await execGit(
      ["status", "--porcelain", "-uall"],
      rootPath,
    );

    const result: Record<string, string> = {};
    const lines = raw.split("\n").filter(Boolean);

    for (const line of lines) {
      const x = line.charAt(0);
      const y = line.charAt(1);
      let filePath = line.slice(3);

      const arrowIndex = filePath.indexOf(" -> ");
      if (arrowIndex !== -1) {
        filePath = filePath.slice(arrowIndex + 4);
      }

      result[path.join(rootPath, filePath)] = parseGitStatusCode(x, y);
    }

    return result;
  } catch {
    return null;
  }
});

ipcMain.handle(
  "ui:show-native-context-menu",
  async (event, request: NativeContextMenuRequest) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) ?? win;
    if (!targetWindow) {
      return null;
    }

    return await new Promise<string | null>((resolve) => {
      let settled = false;
      const settle = (actionId: string | null) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(actionId);
      };

      const menu = Menu.buildFromTemplate(
        request.items.map((item) => {
          if (item.type === "separator") {
            return { type: "separator" as const };
          }

          return {
            accelerator: item.accelerator,
            click: () => settle(item.id),
            enabled: item.enabled ?? true,
            label: item.label,
          };
        }),
      );

      menu.popup({
        callback: () => settle(null),
        window: targetWindow,
        x: typeof request.x === "number" ? Math.floor(request.x) : undefined,
        y: typeof request.y === "number" ? Math.floor(request.y) : undefined,
      });
    });
  },
);

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
