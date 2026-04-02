import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import Store from "electron-store";
import { DEFAULT_APPLICATION_SETTINGS } from "../../src/lib/application-settings";

export interface ProjectPermissions {
  read: boolean;
  write: boolean;
  status: "granted" | "partial" | "denied";
  message?: string;
}

export interface ProjectNode {
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

export interface ProjectSnapshot {
  source: "electron";
  roots: ProjectNode[];
}

export const store = new Store({
  defaults: {
    applicationSettings: DEFAULT_APPLICATION_SETTINGS,
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

export async function getPermissions(targetPath: string): Promise<ProjectPermissions> {
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
    return { read: true, write: true, status: "granted" };
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

export async function buildProjectNode(
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

export function dedupeRootPaths(rootPaths: string[]) {
  return [...new Set(rootPaths)];
}

export async function buildProjectSnapshot(rootPaths: string[]): Promise<ProjectSnapshot> {
  const roots: ProjectNode[] = [];
  for (const rootPath of dedupeRootPaths(rootPaths)) {
    const rootNode = await buildProjectNode(rootPath, null, rootPath);
    if (rootNode.kind !== "directory") {
      throw new Error("Projects must start from a folder.");
    }
    roots.push(rootNode);
  }

  return { source: "electron", roots };
}

export function sortNodes(left: ProjectNode, right: ProjectNode) {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

export function getStoredRootPaths() {
  const storedValue = store.get("lastProjectPaths");
  if (!Array.isArray(storedValue)) {
    return [];
  }

  return storedValue.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export function setStoredRootPaths(rootPaths: string[]) {
  store.set("lastProjectPaths", dedupeRootPaths(rootPaths));
}

export function findRootPath(targetPath: string, rootPaths: string[]) {
  return rootPaths
    .slice()
    .sort((left, right) => right.length - left.length)
    .find((rootPath) => targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`));
}

export async function listDirectoryChildren(directoryPath: string, rootPath: string): Promise<ProjectNode[]> {
  const entries = await fs.readdir(directoryPath);
  const children = await Promise.all(
    entries
      .sort((left, right) => left.localeCompare(right))
      .map(async (entry) => buildProjectNode(path.join(directoryPath, entry), directoryPath, rootPath)),
  );
  return children.sort(sortNodes);
}

export async function ensureWritable(targetPath: string, message: string) {
  const permissions = await getPermissions(targetPath);
  if (!permissions.write) {
    throw new Error(message);
  }
}

export async function ensurePathExists(targetPath: string) {
  try {
    await fs.access(targetPath, fsConstants.F_OK);
  } catch {
    throw new Error(`Path does not exist: ${targetPath}`);
  }
}

export async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function getAvailableCopyPath(targetDirectoryPath: string, sourceName: string) {
  const parsed = path.parse(sourceName);
  const baseName = parsed.ext ? parsed.name : sourceName;
  const extension = parsed.ext;
  let attempt = 0;

  while (attempt < 1000) {
    const suffix = attempt === 0 ? " copy" : ` copy ${attempt + 1}`;
    const candidateName = `${baseName}${suffix}${extension}`;
    const candidatePath = path.join(targetDirectoryPath, candidateName);

    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }

    attempt += 1;
  }

  throw new Error("Unable to determine a destination for the copied item.");
}
