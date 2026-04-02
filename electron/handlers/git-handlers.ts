import { ipcMain } from "electron";
import { constants as fsConstants, promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";

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

export function registerGitHandlers() {
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
}
