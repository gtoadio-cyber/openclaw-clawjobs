import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildExecutionContext, runLocalExec } from "./local-exec.js";
import { runJsonTask } from "./json-agent.js";
import { renderClawJobsPage } from "./web-ui.js";

type ClawJobsPluginApi = {
  config: Record<string, unknown>;
  pluginConfig?: Record<string, unknown>;
  logger: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
  runtime: {
    state: {
      resolveStateDir: () => string;
    };
  };
};

type ClawJobsPluginConfig = {
  hubUrl?: string;
  hubToken?: string;
  nickname?: string;
  peerId?: string;
  workspaceDir?: string;
  brain?: {
    provider?: string;
    model?: string;
    maxSteps?: number;
    timeoutMs?: number;
  };
  execution?: {
    defaultCwd?: string;
    maxCommandMs?: number;
    maxOutputChars?: number;
  };
};

type PeerRecord = {
  peerId: string;
  nickname: string;
  platform?: string;
  version?: string;
  online?: boolean;
  lastSeenAt?: string;
  executionContext?: Record<string, unknown> | null;
};

type TaskRecord = {
  id: string;
  prompt: string;
  createdAt?: string;
  updatedAt?: string;
  ownerPeerId: string;
  ownerNickname?: string;
  assigneePeerId?: string | null;
  assigneeNickname?: string | null;
  status: "pending" | "claimed" | "running" | "done" | "failed";
  workingDirectory?: string | null;
  ownerExecutionContext?: Record<string, unknown> | null;
  logs?: Array<{ ts: string; text: string }>;
  resultText?: string | null;
  errorText?: string | null;
};

type ServiceSnapshot = {
  peers: PeerRecord[];
  tasks: TaskRecord[];
};

type PendingExecRequest = {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function resolvePrimaryModel(config: Record<string, unknown>) {
  const agents = (config?.agents || {}) as {
    defaults?: {
      model?: string | { primary?: string };
    };
  };
  const modelConfig = agents.defaults?.model;
  const primary =
    typeof modelConfig === "string"
      ? modelConfig.trim()
      : typeof modelConfig?.primary === "string"
        ? modelConfig.primary.trim()
        : "";
  if (!primary || !primary.includes("/")) {
    return { provider: undefined, model: undefined };
  }
  const [provider, ...rest] = primary.split("/");
  return {
    provider: provider || undefined,
    model: rest.join("/") || undefined,
  };
}

function resolveAuthProfileId(config: Record<string, unknown>, provider?: string) {
  if (!provider) {
    return undefined;
  }
  const authProfiles = (((config?.auth || {}) as { profiles?: Record<string, { provider?: string }> })
    .profiles || {}) as Record<string, { provider?: string }>;
  for (const [profileId, profile] of Object.entries(authProfiles)) {
    if (profile?.provider === provider) {
      return profileId;
    }
  }
  return undefined;
}

function trimText(value: string, max = 4000) {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value;
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function ensureDir(targetPath: string) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function readIdentity(identityPath: string) {
  try {
    const raw = await fs.readFile(identityPath, "utf8");
    return safeJsonParse<{ peerId?: string }>(raw);
  } catch {
    return null;
  }
}

async function writeIdentity(identityPath: string, peerId: string) {
  await ensureDir(path.dirname(identityPath));
  await fs.writeFile(identityPath, `${JSON.stringify({ peerId }, null, 2)}\n`, "utf8");
}

export class ClawJobsService {
  api: ClawJobsPluginApi;
  cfg: ClawJobsPluginConfig;
  peerId = "";
  nickname = "";
  workspaceDir = "";
  hubUrl = "";
  hubToken = "";
  connected = false;
  lastError = "";
  cursor = 0;
  snapshot: ServiceSnapshot = { peers: [], tasks: [] };
  running = false;
  pollingAbort: AbortController | null = null;
  reconnectTimer: NodeJS.Timeout | null = null;
  sseClients = new Set();
  activeRuns = new Map<string, Promise<void>>();
  pendingExec = new Map<string, PendingExecRequest>();

  constructor(api: ClawJobsPluginApi) {
    this.api = api;
    this.cfg = (api.pluginConfig || {}) as ClawJobsPluginConfig;
    this.workspaceDir =
      this.cfg.workspaceDir ||
      (((api.config?.agents || {}) as { defaults?: { workspace?: string } }).defaults?.workspace ??
        process.cwd());
    this.hubUrl = String(this.cfg.hubUrl || "").replace(/\/$/, "");
    this.hubToken = String(this.cfg.hubToken || "").trim();
    this.nickname = (this.cfg.nickname || os.hostname()).trim();
  }

  get connectionState() {
    return {
      connected: this.connected,
      lastError: this.lastError,
      hubUrl: this.hubUrl,
      nickname: this.nickname,
      peerId: this.peerId,
    };
  }

  async initIdentity() {
    if (this.peerId) {
      return;
    }
    if (typeof this.cfg.peerId === "string" && this.cfg.peerId.trim()) {
      this.peerId = this.cfg.peerId.trim();
      return;
    }
    const stateDir = this.api.runtime.state.resolveStateDir();
    const identityPath = path.join(stateDir, "plugins", "clawjobs", "identity.json");
    const saved = await readIdentity(identityPath);
    if (saved?.peerId) {
      this.peerId = saved.peerId;
      return;
    }
    this.peerId = crypto.randomUUID();
    await writeIdentity(identityPath, this.peerId);
  }

  async start() {
    if (this.running) {
      return;
    }
    await this.initIdentity();
    if (!this.hubUrl || !this.hubToken) {
      this.lastError = "ClawJobs is not configured: missing hubUrl or hubToken.";
      this.api.logger.warn(this.lastError);
      this.broadcast();
      return;
    }
    this.running = true;
    this.loop().catch((error) => {
      this.lastError = error.message || String(error);
      this.broadcast();
    });
  }

  async stop() {
    this.running = false;
    this.connected = false;
    this.pollingAbort?.abort();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const pending of this.pendingExec.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("service stopped"));
    }
    this.pendingExec.clear();
    for (const res of this.sseClients) {
      try {
        res.end();
      } catch {}
    }
    this.sseClients.clear();
  }

  async loop() {
    while (this.running) {
      try {
        await this.connect();
        await this.pollLoop();
      } catch (error) {
        this.connected = false;
        this.lastError = error.message || String(error);
        this.broadcast();
        await new Promise((resolve) => {
          this.reconnectTimer = setTimeout(resolve, 3000);
        });
      }
    }
  }

  async connect() {
    const executionContext = await buildExecutionContext({
      workspaceDir: this.workspaceDir,
      configuredDefaultCwd:
        this.cfg.execution?.defaultCwd || this.cfg.workspaceDir || this.workspaceDir,
    });
    const response = await fetch(`${this.hubUrl}/api/connect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: this.hubToken,
        peerId: this.peerId,
        nickname: this.nickname,
        platform: process.platform,
        version: "0.2.3",
        executionContext,
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "connect failed");
    }
    this.connected = true;
    this.lastError = "";
    this.cursor = Number(payload.cursor || 0);
    this.snapshot = payload.snapshot || { peers: [], tasks: [] };
    this.broadcast();
    this.ensureTaskRuns();
  }

  async pollLoop() {
    while (this.running && this.connected) {
      this.pollingAbort = new AbortController();
      const response = await fetch(
        `${this.hubUrl}/api/poll?token=${encodeURIComponent(this.hubToken)}&peerId=${encodeURIComponent(
          this.peerId,
        )}&cursor=${this.cursor}`,
        {
          signal: this.pollingAbort.signal,
        },
      );
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || "poll failed");
      }
      this.cursor = Number(payload.cursor || this.cursor);
      const events = Array.isArray(payload.events) ? payload.events : [];
      for (const event of events) {
        await this.handleHubEvent(event);
      }
    }
  }

  async handleHubEvent(event: Record<string, unknown>) {
    switch (event?.type) {
      case "snapshot":
        this.snapshot = (event.snapshot || { peers: [], tasks: [] }) as ServiceSnapshot;
        this.broadcast();
        this.ensureTaskRuns();
        return;
      case "exec_request":
        await this.handleExecRequest(event);
        return;
      case "exec_response":
        this.handleExecResponse(event);
        return;
      default:
        return;
    }
  }

  async sendAction(action: Record<string, unknown>) {
    const response = await fetch(`${this.hubUrl}/api/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: this.hubToken,
        peerId: this.peerId,
        action,
      }),
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "action failed");
    }
  }

  async createTask(input: { prompt: string; workingDirectory?: string }) {
    const prompt = String(input.prompt || "").trim();
    if (!prompt) {
      throw new Error("prompt required");
    }
    await this.sendAction({
      type: "create_task",
      prompt,
      workingDirectory: String(input.workingDirectory || "").trim() || null,
      executionContext: await buildExecutionContext({
        workspaceDir: this.workspaceDir,
        configuredDefaultCwd:
          this.cfg.execution?.defaultCwd || this.cfg.workspaceDir || this.workspaceDir,
      }),
    });
  }

  async claimTask(taskId: string) {
    await this.sendAction({
      type: "claim_task",
      taskId,
    });
  }

  getTask(taskId: string) {
    return this.snapshot.tasks.find((task) => task.id === taskId) || null;
  }

  ensureTaskRuns() {
    for (const task of this.snapshot.tasks) {
      if (task.assigneePeerId !== this.peerId) {
        continue;
      }
      if (!["claimed", "running"].includes(task.status)) {
        continue;
      }
      if (this.activeRuns.has(task.id)) {
        continue;
      }
      const promise = this.runTask(task).finally(() => {
        this.activeRuns.delete(task.id);
      });
      this.activeRuns.set(task.id, promise);
    }
  }

  async runTask(task: TaskRecord) {
    try {
      await this.sendAction({
        type: "task_status",
        taskId: task.id,
        status: "running",
        text: "Assignee started reasoning.",
      });

      const history: Array<Record<string, unknown>> = [];
      const maxSteps = Math.max(2, Math.floor(this.cfg.brain?.maxSteps || 8));
      const timeoutMs = Math.max(15_000, Math.floor(this.cfg.brain?.timeoutMs || 60_000));
      const defaults = resolvePrimaryModel(this.api.config || {});
      const provider = this.cfg.brain?.provider || defaults.provider;
      const model = this.cfg.brain?.model || defaults.model;
      const authProfileId = resolveAuthProfileId(this.api.config || {}, provider);

      for (let step = 1; step <= maxSteps; step += 1) {
        const liveTask = this.getTask(task.id) || task;
        const decision = await runJsonTask({
          api: this.api,
          workspaceDir: this.workspaceDir,
          provider,
          model,
          authProfileId,
          timeoutMs,
          prompt: [
            "Goal: complete the remote task below.",
            "Rules:",
            "1. You are the assignee and only provide reasoning.",
            "2. Any real command must go through owner_exec.",
            "3. Keep owner_exec.command short, direct, and executable.",
            "4. Never invent execution results.",
            "5. If you already have the answer, return finish.",
            "6. If you cannot continue safely, return fail.",
          ].join("\n"),
          input: {
            step,
            stepsRemaining: maxSteps - step,
            task: {
              id: liveTask.id,
              prompt: liveTask.prompt,
              workingDirectory: liveTask.workingDirectory || null,
              ownerExecutionContext: liveTask.ownerExecutionContext || null,
            },
            history,
          },
        });

        await this.sendAction({
          type: "task_log",
          taskId: task.id,
          level: "info",
          text: `Step ${step} reasoning: ${decision.note}`,
        });

        if (decision.action === "finish") {
          await this.sendAction({
            type: "task_finish",
            taskId: task.id,
            status: "done",
            resultText: decision.resultText,
          });
          return;
        }

        if (decision.action === "fail") {
          await this.sendAction({
            type: "task_finish",
            taskId: task.id,
            status: "failed",
            errorText: decision.errorText,
          });
          return;
        }

        const requestId = crypto.randomUUID();
        await this.sendAction({
          type: "task_log",
          taskId: task.id,
          level: "info",
          text: `Requesting owner-side execution: ${decision.command}`,
        });

        const execResult = await this.requestOwnerExec(task.id, {
          requestId,
          command: decision.command,
          cwd: decision.cwd || null,
          timeoutMs: decision.timeoutMs || this.cfg.execution?.maxCommandMs || 60_000,
        });

        history.push({
          step,
          action: "owner_exec",
          note: decision.note,
          command: decision.command,
          result: {
            ok: execResult.ok === true,
            exitCode: execResult.exitCode,
            stdout: trimText(String(execResult.stdout || ""), 3000),
            stderr: trimText(String(execResult.stderr || execResult.error || ""), 2000),
          },
        });

        await this.sendAction({
          type: "task_log",
          taskId: task.id,
          level: execResult.ok === true ? "info" : "warn",
          text:
            execResult.ok === true
              ? `Execution completed, exitCode=${String(execResult.exitCode)}`
              : `Execution failed, exitCode=${String(execResult.exitCode ?? "null")}. Continuing analysis.`,
        });
      }

      await this.sendAction({
        type: "task_finish",
        taskId: task.id,
        status: "failed",
        errorText: `The task did not complete within the maximum number of steps (${maxSteps}).`,
      });
    } catch (error) {
      await this.sendAction({
        type: "task_finish",
        taskId: task.id,
        status: "failed",
        errorText: error.message || String(error),
      });
    }
  }

  async requestOwnerExec(
    taskId: string,
    payload: { requestId: string; command: string; cwd?: string | null; timeoutMs?: number },
  ) {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingExec.delete(payload.requestId);
        reject(new Error("owner execution timeout"));
      }, Math.max(10_000, Math.floor((payload.timeoutMs || 60_000) + 15_000)));

      this.pendingExec.set(payload.requestId, { resolve, reject, timer });
      this.sendAction({
        type: "exec_request",
        taskId,
        requestId: payload.requestId,
        command: payload.command,
        cwd: payload.cwd || null,
        timeoutMs: payload.timeoutMs || null,
      }).catch((error) => {
        clearTimeout(timer);
        this.pendingExec.delete(payload.requestId);
        reject(error);
      });
    });
  }

  handleExecResponse(event: Record<string, unknown>) {
    const requestId = typeof event.requestId === "string" ? event.requestId : "";
    const pending = this.pendingExec.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingExec.delete(requestId);
    const result =
      event.result && typeof event.result === "object" ? { ...(event.result as object) } : {};
    pending.resolve({
      ok: event.ok !== false,
      ...(result as Record<string, unknown>),
    });
  }

  async handleExecRequest(event: Record<string, unknown>) {
    const taskId = typeof event.taskId === "string" ? event.taskId : "";
    const task = this.getTask(taskId);
    const requestId = typeof event.requestId === "string" ? event.requestId : "";
    if (!task || task.ownerPeerId !== this.peerId || !requestId) {
      return;
    }
    try {
      const result = await runLocalExec({
        command: String(event.command || ""),
        cwd: typeof event.cwd === "string" ? event.cwd : null,
        defaultCwd:
          this.cfg.execution?.defaultCwd || this.cfg.workspaceDir || this.workspaceDir || null,
        taskWorkingDirectory: task.workingDirectory || null,
        timeoutMs:
          typeof event.timeoutMs === "number"
            ? event.timeoutMs
            : this.cfg.execution?.maxCommandMs || 60_000,
        maxOutputChars: this.cfg.execution?.maxOutputChars || 12_000,
      });

      await this.sendAction({
        type: "exec_response",
        requestId,
        ok: true,
        result,
      });
    } catch (error) {
      await this.sendAction({
        type: "exec_response",
        requestId,
        ok: false,
        result: {
          error: error.message || String(error),
        },
      });
    }
  }

  getBrowserState() {
    return {
      self: {
        peerId: this.peerId,
        nickname: this.nickname,
      },
      connection: this.connectionState,
      peers: this.snapshot.peers,
      tasks: this.snapshot.tasks,
    };
  }

  attachSse(res: {
    writeHead: (status: number, headers: Record<string, string>) => void;
    write: (chunk: string) => void;
    on: (name: string, handler: () => void) => void;
  }) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    this.sseClients.add(res);
    res.write(`data: ${JSON.stringify(this.getBrowserState())}\n\n`);
    res.on("close", () => {
      this.sseClients.delete(res);
    });
  }

  broadcast() {
    const payload = `data: ${JSON.stringify(this.getBrowserState())}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(payload);
      } catch {}
    }
  }
}

export function createHttpHandler(service: ClawJobsService) {
  return async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const pathname = url.pathname.replace(/^\/plugins\/clawjobs/, "") || "/";

    if (req.method === "GET" && (pathname === "/" || pathname === "")) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(renderClawJobsPage());
      return true;
    }

    if (req.method === "GET" && pathname === "/api/state") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(service.getBrowserState()));
      return true;
    }

    if (req.method === "GET" && pathname === "/api/events") {
      service.attachSse(res);
      return true;
    }

    if (req.method === "POST" && pathname === "/api/create-task") {
      const body = await readRequestJson(req);
      await service.createTask({
        prompt: String(body.prompt || ""),
        workingDirectory: String(body.workingDirectory || ""),
      });
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    if (req.method === "POST" && pathname === "/api/claim-task") {
      const body = await readRequestJson(req);
      await service.claimTask(String(body.taskId || ""));
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ ok: true }));
      return true;
    }

    res.statusCode = 404;
    res.end("not found");
    return true;
  };
}

async function readRequestJson(req: AsyncIterable<Buffer>) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}
