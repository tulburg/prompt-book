import { ipcMain } from "electron";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { buildLlamaServerArgs } from "./lms-config";

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
    const binaryPath = resolveLlamaBinaryPath();
    if (!binaryPath) {
      throw new Error("llama-server binary not found. Please install llama.cpp first.");
    }

    const tempPort = 38000 + Math.floor(Math.random() * 10000);
    const args = ["-hf", modelId, "--host", "127.0.0.1", "--port", String(tempPort)];

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(binaryPath, args, {
        env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let settled = false;
      let lastOutput = "";

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (healthPoller) clearInterval(healthPoller);
        if (heartbeat) clearInterval(heartbeat);
        if (error) reject(error);
        else resolve();
      };

      const stopTempServer = () => {
        try { proc.kill(); } catch { /* ignore */ }
      };

      const emitProgress = (message: string) => {
        const cleaned = message.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").trim();
        if (!cleaned) return;
        lastOutput = cleaned;
        event.sender.send("lms:download-progress", { modelId, message: cleaned });
      };

      let stdoutBuf = "";
      let stderrBuf = "";

      const handleChunk = (chunk: Buffer, isStdout: boolean) => {
        const buffered = (isStdout ? stdoutBuf : stderrBuf) + chunk.toString();
        const segments = buffered.split(/\r\n|[\r\n]/);
        const nextBuffer = /[\r\n]$/.test(buffered) ? "" : (segments.pop() ?? "");
        for (const segment of segments) emitProgress(segment);
        if (isStdout) stdoutBuf = nextBuffer;
        else stderrBuf = nextBuffer;
      };

      proc.stdout?.on("data", (chunk: Buffer) => handleChunk(chunk, true));
      proc.stderr?.on("data", (chunk: Buffer) => handleChunk(chunk, false));
      proc.on("error", (error) => finish(error));
      proc.on("close", (code) => {
        if (stdoutBuf) emitProgress(stdoutBuf);
        if (stderrBuf) emitProgress(stderrBuf);
        if (!settled) {
          const detail = lastOutput ? ` — ${lastOutput}` : "";
          finish(new Error(`llama-server -hf exited with code ${code ?? "unknown"}${detail}`));
        }
      });

      const heartbeat = setInterval(() => {
        if (!settled) {
          event.sender.send("lms:download-progress", { modelId, message: "Downloading model into llama.cpp cache..." });
        }
      }, 3000);

      const tempBaseUrl = `http://127.0.0.1:${tempPort}`;
      const startedAt = Date.now();
      const healthPoller = setInterval(async () => {
        if (settled) return;
        try {
          const response = await fetch(`${tempBaseUrl}/health`, { signal: AbortSignal.timeout(1000) });
          if (response.ok) {
            event.sender.send("lms:download-progress", { modelId, message: "Model cached successfully." });
            stopTempServer();
            finish();
            return;
          }
        } catch {
          // keep polling
        }
        if (Date.now() - startedAt > 10 * 60 * 1000) {
          stopTempServer();
          finish(new Error(`Timed out while caching model ${modelId}.`));
        }
      }, 1000);
    });
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

    const localModelsDir = isWindows
      ? expandLmsPath("%LOCALAPPDATA%\\llama.cpp\\local-models")
      : process.platform === "darwin"
        ? expandLmsPath("~/Library/Caches/llama.cpp/local-models")
        : expandLmsPath("~/.cache/llama.cpp/local-models");

    let modelsDir: string | undefined;
    try {
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
