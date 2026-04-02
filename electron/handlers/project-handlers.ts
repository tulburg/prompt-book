import { ipcMain, dialog, BrowserWindow } from "electron";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import {
  buildProjectNode,
  buildProjectSnapshot,
  dedupeRootPaths,
  ensurePathExists,
  ensureWritable,
  findRootPath,
  getAvailableCopyPath,
  getPermissions,
  getStoredRootPaths,
  listDirectoryChildren,
  setStoredRootPaths,
} from "./shared";

export function registerProjectHandlers(win: BrowserWindow | null) {
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

  ipcMain.handle("project:copy-path", async (_event, sourcePath: string, targetDirectoryPath: string) => {
    await ensurePathExists(sourcePath);
    await ensurePathExists(targetDirectoryPath);
    await ensureWritable(
      targetDirectoryPath,
      "You do not have permission to paste items into this location.",
    );

    const sourceName = path.basename(sourcePath);
    const destinationPath = await getAvailableCopyPath(targetDirectoryPath, sourceName);

    await fs.cp(sourcePath, destinationPath, { recursive: true, errorOnExist: true });
    const rootPath = findRootPath(targetDirectoryPath, getStoredRootPaths());
    if (!rootPath) {
      throw new Error(`No workspace root found for: ${targetDirectoryPath}`);
    }

    return {
      parentPath: targetDirectoryPath,
      node: await buildProjectNode(destinationPath, targetDirectoryPath, rootPath),
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

  ipcMain.handle("project:move-path", async (_event, sourcePath: string, targetDirectoryPath: string) => {
    await ensurePathExists(sourcePath);
    await ensurePathExists(targetDirectoryPath);
    await ensureWritable(
      path.dirname(sourcePath),
      "You do not have permission to move items from this location.",
    );
    await ensureWritable(
      targetDirectoryPath,
      "You do not have permission to move items to this location.",
    );

    const name = path.basename(sourcePath);
    const destinationPath = path.join(targetDirectoryPath, name);

    try {
      await fs.access(destinationPath, fsConstants.F_OK);
      throw new Error(`An item named "${name}" already exists in the destination.`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    await fs.rename(sourcePath, destinationPath);
    const rootPath = findRootPath(targetDirectoryPath, getStoredRootPaths());
    if (!rootPath) {
      throw new Error(`No workspace root found for: ${targetDirectoryPath}`);
    }
    return {
      oldPath: sourcePath,
      parentPath: targetDirectoryPath,
      node: await buildProjectNode(destinationPath, targetDirectoryPath, rootPath),
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
}
