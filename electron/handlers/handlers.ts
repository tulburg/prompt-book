import { ipcMain } from "electron";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { buildLlamaServerArgs } from "./lms-config";
import {
  downloadModelToLocalStore,
  emitDownloadProgress,
  getLocalModelsDir,
} from "./model-download";

const isWindows = process.platform === "win32";

function expandLmsPath(rawPath: string): string {
  let result = rawPath;
  if (result.startsWith("~")) {
    result = path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", result.slice(1));
  }
  result = result.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] ?? `%${key}%`);
  return result;
}

function whichSync(cmd: string): string | undefined {
  try {
    const lookupCmd = isWindows ? "where" : "which";
    const result = spawnSync(lookupCmd, [cmd], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) {
      return undefined;
    }
    const line = (result.stdout ?? "")
      .split(/\r?\n/)
      .map((c) => c.trim())
      .find(Boolean);
    return line || undefined;
  } catch {
    return undefined;
  }
}

function resolveLlamaBinaryPath(): string | undefined {
  const candidates = isWindows
    ? [
        expandLmsPath("%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\llama-server.exe"),
        expandLmsPath("%ProgramFiles%\\llama.cpp\\llama-server.exe"),
      ]
    : [
        "/opt/homebrew/bin/llama-server",
        "/usr/local/bin/llama-server",
        expandLmsPath("~/.local/bin/llama-server"),
      ];

  for (const candidate of candidates) {
    try {
      require("fs").accessSync(candidate, require("fs").constants.X_OK);
      return candidate;
    } catch {
      // try next
    }
  }

  return whichSync(isWindows ? "llama-server.exe" : "llama-server") ?? whichSync("llama-server");
}

let lmsServerProcess: ReturnType<typeof spawn> | undefined;
const activeModelDownloads = new Map<string, AbortController>();

function splitDownloadSpecifier(modelId: string): { repoId: string; quantization?: string } {
  const separatorIndex = modelId.lastIndexOf(":");
  if (separatorIndex === -1) {
    return { repoId: modelId };
  }
  return {
    repoId: modelId.slice(0, separatorIndex),
    quantization: modelId.slice(separatorIndex + 1) || undefined,
  };
}

export function killLmsServer() {
  if (lmsServerProcess) {
    try { lmsServerProcess.kill(); } catch { /* ignore */ }
    lmsServerProcess = undefined;
  }
}

export function registerLmsHandlers() {
  ipcMain.handle("lms:is-binary-installed", async () => {
    return resolveLlamaBinaryPath() !== undefined;
  });

  ipcMain.handle("lms:download-binary", async () => {
    return new Promise<void>((resolve, reject) => {
      const command = isWindows ? "winget" : "brew";
      const args = isWindows
        ? ["install", "llama.cpp", "--accept-package-agreements", "--accept-source-agreements"]
        : ["install", "llama.cpp"];
      const binaryPath = whichSync(command) ?? command;
      const proc = spawn(binaryPath, args, {
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${command} exited with code ${code}`));
        }
      });
    });
  });

  ipcMain.handle("lms:download-model", async (event, modelId: string) => {
    const abort = new AbortController();
    activeModelDownloads.set(modelId, abort);
    try {
      const { repoId, quantization } = splitDownloadSpecifier(modelId);
      return await downloadModelToLocalStore({
        modelId: repoId,
        progressModelId: modelId,
        quantization,
        signal: abort.signal,
        sender: event.sender,
      });
    } catch (error) {
      const phase = abort.signal.aborted ? "cancelled" : "error";
      emitDownloadProgress(event.sender, {
        modelId,
        phase,
        message:
          error instanceof Error
            ? error.message
            : abort.signal.aborted
              ? "Download cancelled."
              : "Download failed.",
      });
      throw error;
    } finally {
      if (activeModelDownloads.get(modelId) === abort) {
        activeModelDownloads.delete(modelId);
      }
    }
  });

  ipcMain.handle("lms:cancel-download-model", async (_event, modelId: string) => {
    activeModelDownloads.get(modelId)?.abort();
    activeModelDownloads.delete(modelId);
  });

  ipcMain.handle("lms:start-server", async (_event, serverUrl: string) => {
    const binaryPath = resolveLlamaBinaryPath();
    if (!binaryPath) {
      throw new Error("llama-server binary not found. Please install llama.cpp first.");
    }

    let port = "8123";
    try {
      const parsed = new URL(serverUrl);
      port = parsed.port || "8123";
    } catch {
      // use default
    }

    let modelsDir: string | undefined;
    try {
      const localModelsDir = getLocalModelsDir();
      require("fs").accessSync(localModelsDir, require("fs").constants.F_OK);
      modelsDir = localModelsDir;
    } catch {
      // no local models dir
    }

    const args = buildLlamaServerArgs({
      port,
      localModelsDir: modelsDir,
    });

    if (lmsServerProcess) {
      try {
        lmsServerProcess.kill();
      } catch {
        // ignore
      }
    }

    lmsServerProcess = spawn(binaryPath, args, {
      env: { ...process.env },
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    lmsServerProcess.on("error", (error) => {
      console.error("[LMS] Server spawn error:", error);
      lmsServerProcess = undefined;
    });

    lmsServerProcess.on("close", () => {
      lmsServerProcess = undefined;
    });
  });

  ipcMain.handle("lms:stop-server", async () => {
    if (lmsServerProcess) {
      lmsServerProcess.kill();
      lmsServerProcess = undefined;
    }
  });
}
