import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export type LocalExecOptions = {
  command: string;
  cwd?: string | null;
  defaultCwd?: string | null;
  taskWorkingDirectory?: string | null;
  timeoutMs?: number;
  maxOutputChars?: number;
};

export type LocalExecResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  cwd: string | null;
  shell: string;
  truncated: boolean;
};

function resolveShell(): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      shell: "powershell.exe",
      args: ["-NoProfile", "-Command"],
    };
  }
  const preferred = [process.env.SHELL, "/bin/zsh", "/bin/bash"].find(
    (value) => typeof value === "string" && value.trim(),
  );
  return {
    shell: preferred || "/bin/sh",
    args: ["-lc"],
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function withinDirectory(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function buildExecutionContext(params: {
  workspaceDir?: string | null;
  configuredDefaultCwd?: string | null;
}) {
  const shellInfo = resolveShell();
  const defaultCwd =
    (params.configuredDefaultCwd && params.configuredDefaultCwd.trim()) ||
    (params.workspaceDir && params.workspaceDir.trim()) ||
    os.homedir();

  return {
    machineName: os.hostname(),
    platform: process.platform,
    defaultCwd,
    shell: shellInfo.shell,
  };
}

export async function runLocalExec(options: LocalExecOptions): Promise<LocalExecResult> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(5_000, Math.floor(options.timeoutMs || 60_000));
  const maxOutputChars = Math.max(2000, Math.floor(options.maxOutputChars || 12_000));
  const shellInfo = resolveShell();

  let cwd =
    (typeof options.cwd === "string" && options.cwd.trim() ? options.cwd.trim() : null) ||
    (typeof options.taskWorkingDirectory === "string" && options.taskWorkingDirectory.trim()
      ? options.taskWorkingDirectory.trim()
      : null) ||
    (typeof options.defaultCwd === "string" && options.defaultCwd.trim()
      ? options.defaultCwd.trim()
      : null);

  if (cwd && options.taskWorkingDirectory) {
    const taskRoot = path.resolve(options.taskWorkingDirectory);
    const resolvedCandidate = path.isAbsolute(cwd) ? path.resolve(cwd) : path.resolve(taskRoot, cwd);
    if (!withinDirectory(taskRoot, resolvedCandidate)) {
      throw new Error("cwd is outside the task working directory.");
    }
    cwd = resolvedCandidate;
  } else if (cwd) {
    cwd = path.resolve(cwd);
  }

  if (cwd && !(await pathExists(cwd))) {
    throw new Error(`cwd does not exist: ${cwd}`);
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(shellInfo.shell, [...shellInfo.args, options.command], {
      cwd: cwd || undefined,
      env: process.env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let settled = false;

    const appendChunk = (current: string, chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const remaining = maxOutputChars - current.length;
      if (remaining <= 0) {
        truncated = true;
        return current;
      }
      if (text.length > remaining) {
        truncated = true;
        return current + text.slice(0, remaining);
      }
      return current + text;
    };

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      truncated = true;
      child.kill("SIGTERM");
      settled = true;
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: stderr || "command timed out",
        durationMs: Date.now() - startedAt,
        cwd,
        shell: shellInfo.shell,
        truncated,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendChunk(stdout, chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr = appendChunk(stderr, chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        cwd,
        shell: shellInfo.shell,
        truncated,
      });
    });
  });
}
