import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

type RunJsonTaskParams = {
  api: {
    config: Record<string, unknown>;
    logger: {
      warn: (message: string) => void;
    };
  };
  workspaceDir: string;
  provider?: string;
  model?: string;
  authProfileId?: string;
  timeoutMs: number;
  prompt: string;
  input: unknown;
};

export type BrainDecision =
  | {
      action: "owner_exec";
      note: string;
      command: string;
      cwd?: string | null;
      timeoutMs?: number;
    }
  | {
      action: "finish";
      note: string;
      resultText: string;
    }
  | {
      action: "fail";
      note: string;
      errorText: string;
    };

type RunEmbeddedPiAgentFn = (params: Record<string, unknown>) => Promise<{
  payloads?: Array<{ text?: string; isError?: boolean }>;
}>;

function collectAssistantText(payloads: Array<{ text?: string; isError?: boolean }> | undefined) {
  return (payloads || [])
    .filter((item) => !item.isError && typeof item.text === "string")
    .map((item) => item.text || "")
    .join("\n")
    .trim();
}

function stripCodeFence(value: string) {
  const trimmed = value.trim();
  const matched = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return matched ? (matched[1] || "").trim() : trimmed;
}

function validateDecision(value: unknown): BrainDecision {
  if (!value || typeof value !== "object") {
    throw new Error("The model did not return an object.");
  }
  const action = typeof value.action === "string" ? value.action : "";
  const note = typeof value.note === "string" ? value.note.trim() : "";
  if (!note) {
    throw new Error("The model response is missing note.");
  }
  if (action === "owner_exec") {
    const command = typeof value.command === "string" ? value.command.trim() : "";
    if (!command) {
      throw new Error("owner_exec is missing command.");
    }
    return {
      action,
      note,
      command,
      cwd: typeof value.cwd === "string" ? value.cwd : null,
      timeoutMs:
        typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs)
          ? value.timeoutMs
          : undefined,
    };
  }
  if (action === "finish") {
    const resultText = typeof value.resultText === "string" ? value.resultText.trim() : "";
    if (!resultText) {
      throw new Error("finish is missing resultText.");
    }
    return {
      action,
      note,
      resultText,
    };
  }
  if (action === "fail") {
    const errorText = typeof value.errorText === "string" ? value.errorText.trim() : "";
    if (!errorText) {
      throw new Error("fail is missing errorText.");
    }
    return {
      action,
      note,
      errorText,
    };
  }
  throw new Error(`Unknown action: ${action || "<empty>"}`);
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function addCandidate(candidatePaths: Set<string>, basePath: string) {
  const normalizedBase = path.resolve(basePath);
  let current = normalizedBase;

  while (true) {
    candidatePaths.add(path.join(current, "dist", "extensionAPI.js"));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

async function tryAddRealPathCandidates(candidatePaths: Set<string>, inputPath: string) {
  if (!inputPath || typeof inputPath !== "string") {
    return;
  }
  try {
    const realPath = await fs.realpath(inputPath);
    addCandidate(candidatePaths, path.dirname(realPath));
  } catch {
    addCandidate(candidatePaths, path.dirname(inputPath));
  }
}

function resolveCliPathFromShell() {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, ["openclaw"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return null;
  }
  const firstLine = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || null;
}

async function resolveExtensionApiPath(): Promise<string> {
  const candidatePaths = new Set<string>();

  for (const runtimePath of [process.argv[1], process.execPath]) {
    if (!runtimePath || typeof runtimePath !== "string") {
      continue;
    }
    await tryAddRealPathCandidates(candidatePaths, runtimePath);
  }

  const cliPath = resolveCliPathFromShell();
  if (cliPath) {
    await tryAddRealPathCandidates(candidatePaths, cliPath);
  }

  for (const candidatePath of candidatePaths) {
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error("Unable to locate OpenClaw extensionAPI.js.");
}

async function loadRunEmbeddedPiAgent(): Promise<RunEmbeddedPiAgentFn> {
  const extensionApiPath = await resolveExtensionApiPath();
  const mod = (await import(pathToFileURL(extensionApiPath).href)) as {
    runEmbeddedPiAgent?: unknown;
  };
  if (typeof mod.runEmbeddedPiAgent !== "function") {
    throw new Error("OpenClaw extensionAPI does not expose runEmbeddedPiAgent.");
  }
  return mod.runEmbeddedPiAgent as RunEmbeddedPiAgentFn;
}

export async function runJsonTask(params: RunJsonTaskParams): Promise<BrainDecision> {
  const inputJson = JSON.stringify(params.input ?? null, null, 2);
  const schemaText = JSON.stringify(
    {
      type: "object",
      additionalProperties: false,
      required: ["action", "note"],
      properties: {
        action: {
          type: "string",
          enum: ["owner_exec", "finish", "fail"],
        },
        note: {
          type: "string",
        },
        command: {
          type: "string",
        },
        cwd: {
          type: ["string", "null"],
        },
        timeoutMs: {
          type: "number",
        },
        resultText: {
          type: "string",
        },
        errorText: {
          type: "string",
        },
      },
    },
    null,
    2,
  );

  const prompt = [
    "You are the assignee brain for a remote ClawJobs task.",
    "You cannot execute commands yourself and you must not pretend that local execution already happened.",
    "All real execution must be sent back to the task owner through owner_exec.",
    "Return exactly one action at a time.",
    "If more information is needed, return owner_exec.",
    "If the answer is ready, return finish.",
    "If the task cannot continue safely, return fail.",
    "Return strict JSON only, with no markdown or extra commentary.",
    "",
    "TASK_PROMPT:",
    params.prompt,
    "",
    "OUTPUT_SCHEMA_JSON:",
    schemaText,
    "",
    "INPUT_JSON:",
    inputJson,
  ].join("\n");

  const tmpDir = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "clawjobs-"));
  const sessionId = `clawjobs-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const sessionFile = path.join(tmpDir, "session.json");
  const runEmbeddedPiAgent = await loadRunEmbeddedPiAgent();

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const runResult = await runEmbeddedPiAgent({
        sessionId: `${sessionId}-${attempt}`,
        sessionFile,
        workspaceDir: params.workspaceDir,
        config: params.api.config,
        prompt:
          attempt === 0
            ? prompt
            : `${prompt}\n\nYour last response was not valid JSON. Return valid JSON only this time.`,
        timeoutMs: params.timeoutMs,
        runId: `${sessionId}-run-${attempt}`,
        provider: params.provider,
        model: params.model,
        authProfileId: params.authProfileId,
        authProfileIdSource: params.authProfileId ? "user" : "auto",
        disableTools: true,
      });

      const text = collectAssistantText(runResult.payloads);
      if (!text) {
        continue;
      }
      try {
        return validateDecision(JSON.parse(stripCodeFence(text)));
      } catch (error) {
        params.api.logger.warn(`clawjobs json parse failed: ${error.message || String(error)}`);
      }
    }
    throw new Error("The model returned invalid JSON twice in a row.");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
