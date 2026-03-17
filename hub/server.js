import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const PORT = Number.parseInt(process.env.CLAWJOBS_PORT || "19888", 10);
const HOST = process.env.CLAWJOBS_HOST || "0.0.0.0";
const TOKEN = (process.env.CLAWJOBS_TOKEN || "").trim();
const DATA_DIR = path.resolve(process.env.CLAWJOBS_DATA_DIR || path.join(process.cwd(), "data"));
const TASKS_PATH = path.join(DATA_DIR, "tasks.json");
const PEER_STALE_MS = 45_000;
const LONG_POLL_TIMEOUT_MS = 25_000;
const EXEC_REQUEST_TIMEOUT_MS = 120_000;
const MAX_EVENTS = 2000;

if (!TOKEN) {
  console.error("Missing CLAWJOBS_TOKEN");
  process.exit(1);
}

const state = {
  peers: new Map(),
  tasks: new Map(),
  events: [],
  nextEventId: 1,
  waiters: new Map(),
  pendingExec: new Map(),
  persistTimer: null,
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadState() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(TASKS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    for (const task of tasks) {
      if (task && typeof task.id === "string") {
        state.tasks.set(task.id, task);
      }
    }
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      console.warn("load tasks failed:", error.message || String(error));
    }
  }
}

function schedulePersist() {
  if (state.persistTimer) {
    return;
  }
  state.persistTimer = setTimeout(async () => {
    state.persistTimer = null;
    try {
      await ensureDataDir();
      const payload = {
        tasks: Array.from(state.tasks.values()),
      };
      await fs.writeFile(TASKS_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } catch (error) {
      console.warn("persist tasks failed:", error.message || String(error));
    }
  }, 300);
}

function nowIso() {
  return new Date().toISOString();
}

function createTaskLog(task, text, level = "info", peerId = null) {
  const entry = {
    id: crypto.randomUUID(),
    ts: nowIso(),
    level,
    peerId,
    text,
  };
  const nextLogs = Array.isArray(task.logs) ? [...task.logs, entry] : [entry];
  task.logs = nextLogs.slice(-120);
}

function publicPeer(peer) {
  return {
    peerId: peer.peerId,
    nickname: peer.nickname,
    platform: peer.platform,
    version: peer.version,
    online: peer.online,
    lastSeenAt: peer.lastSeenAt,
    executionContext: peer.executionContext || null,
  };
}

function publicTask(task) {
  return {
    ...task,
    logs: Array.isArray(task.logs) ? task.logs : [],
  };
}

function currentSnapshot() {
  return {
    peers: Array.from(state.peers.values())
      .map(publicPeer)
      .sort((a, b) => String(a.nickname || a.peerId).localeCompare(String(b.nickname || b.peerId))),
    tasks: Array.from(state.tasks.values())
      .map(publicTask)
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))),
  };
}

function pushEvent(payload, targetPeerId = null) {
  const event = {
    id: state.nextEventId++,
    targetPeerId,
    payload,
  };
  state.events.push(event);
  if (state.events.length > MAX_EVENTS) {
    state.events.shift();
  }
  flushWaiters();
  return event.id;
}

function broadcastSnapshot() {
  pushEvent({ type: "snapshot", snapshot: currentSnapshot() }, null);
}

function flushWaiters() {
  for (const [peerId, waiters] of state.waiters.entries()) {
    const pending = state.events.filter(
      (event) => event.targetPeerId === null || event.targetPeerId === peerId,
    );
    if (!waiters || waiters.length === 0) {
      continue;
    }
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      const events = pending.filter((event) => event.id > waiter.cursor);
      if (events.length > 0) {
        clearTimeout(waiter.timer);
        waiter.resolve({
          cursor: events.at(-1)?.id ?? waiter.cursor,
          events: events.map((event) => event.payload),
        });
      } else {
        waiters.unshift(waiter);
        break;
      }
    }
    if (waiters.length === 0) {
      state.waiters.delete(peerId);
    }
  }
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function requireToken(inputToken) {
  return typeof inputToken === "string" && inputToken.trim() === TOKEN;
}

function touchPeer(peerId, patch = {}) {
  const existing = state.peers.get(peerId) || {
    peerId,
    nickname: peerId,
    platform: process.platform,
    version: "",
    executionContext: null,
    online: true,
    lastSeenAt: nowIso(),
  };
  const next = {
    ...existing,
    ...patch,
    peerId,
    online: true,
    lastSeenAt: nowIso(),
  };
  state.peers.set(peerId, next);
  return next;
}

function resetTasksForPeer(peerId, options = {}) {
  const shouldBroadcast = options.broadcast !== false;
  let changed = false;
  for (const task of state.tasks.values()) {
    if (task.assigneePeerId === peerId && ["claimed", "running"].includes(task.status)) {
      task.status = "pending";
      task.assigneePeerId = null;
      task.assigneeNickname = null;
      task.updatedAt = nowIso();
      createTaskLog(task, "The assignee went offline. The task was returned to pending.", "warn", peerId);
      changed = true;
    }
  }
  if (changed) {
    schedulePersist();
    if (shouldBroadcast) {
      broadcastSnapshot();
    }
  }
  return changed;
}

function cleanupStalePeers() {
  const cutoff = Date.now() - PEER_STALE_MS;
  let changed = false;
  for (const peer of state.peers.values()) {
    const lastSeen = Date.parse(peer.lastSeenAt || "");
    if (!Number.isFinite(lastSeen) || lastSeen > cutoff || peer.online === false) {
      continue;
    }
    peer.online = false;
    peer.lastSeenAt = nowIso();
    changed = true;
    if (resetTasksForPeer(peer.peerId, { broadcast: false })) {
      changed = true;
    }
  }
  if (changed) {
    broadcastSnapshot();
  }
}

function resolvePollEvents(peerId, cursor) {
  const events = state.events.filter(
    (event) => event.id > cursor && (event.targetPeerId === null || event.targetPeerId === peerId),
  );
  return {
    cursor: events.at(-1)?.id ?? cursor,
    events: events.map((event) => event.payload),
  };
}

function queueWaiter(peerId, cursor) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const waiters = state.waiters.get(peerId) || [];
      const index = waiters.findIndex((item) => item.resolve === resolve);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
      if (waiters.length === 0) {
        state.waiters.delete(peerId);
      }
      resolve({ cursor, events: [] });
    }, LONG_POLL_TIMEOUT_MS);

    const waiters = state.waiters.get(peerId) || [];
    waiters.push({ cursor, resolve, timer });
    state.waiters.set(peerId, waiters);
  });
}

function createTaskFromAction(peer, payload) {
  const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
  if (!prompt) {
    throw new Error("prompt required");
  }
  const task = {
    id: crypto.randomUUID(),
    prompt,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ownerPeerId: peer.peerId,
    ownerNickname: peer.nickname,
    assigneePeerId: null,
    assigneeNickname: null,
    status: "pending",
    workingDirectory:
      typeof payload.workingDirectory === "string" && payload.workingDirectory.trim()
        ? payload.workingDirectory.trim()
        : null,
    ownerExecutionContext:
      payload.executionContext && typeof payload.executionContext === "object"
        ? payload.executionContext
        : peer.executionContext || null,
    resultText: null,
    errorText: null,
    logs: [],
  };
  createTaskLog(task, "Task created.", "info", peer.peerId);
  state.tasks.set(task.id, task);
  schedulePersist();
  broadcastSnapshot();
}

function claimTask(peer, payload) {
  const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
  const task = state.tasks.get(taskId);
  if (!task) {
    throw new Error("task not found");
  }
  if (task.status !== "pending") {
    throw new Error("task is not pending");
  }
  task.status = "claimed";
  task.assigneePeerId = peer.peerId;
  task.assigneeNickname = peer.nickname;
  task.updatedAt = nowIso();
  createTaskLog(task, `${peer.nickname} claimed the task.`, "info", peer.peerId);
  schedulePersist();
  broadcastSnapshot();
}

function updateTaskStatus(peer, payload) {
  const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
  const task = state.tasks.get(taskId);
  if (!task) {
    throw new Error("task not found");
  }
  if (task.assigneePeerId !== peer.peerId) {
    throw new Error("only assignee can update task");
  }
  const nextStatus = typeof payload.status === "string" ? payload.status : "";
  if (!["claimed", "running", "done", "failed"].includes(nextStatus)) {
    throw new Error("invalid status");
  }
  task.status = nextStatus;
  task.updatedAt = nowIso();
  if (typeof payload.text === "string" && payload.text.trim()) {
    createTaskLog(task, payload.text.trim(), "info", peer.peerId);
  }
  schedulePersist();
  broadcastSnapshot();
}

function appendTaskLog(peer, payload) {
  const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
  const task = state.tasks.get(taskId);
  if (!task) {
    throw new Error("task not found");
  }
  if (task.assigneePeerId !== peer.peerId && task.ownerPeerId !== peer.peerId) {
    throw new Error("peer cannot write this task log");
  }
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    throw new Error("text required");
  }
  const level =
    typeof payload.level === "string" && ["info", "warn", "error"].includes(payload.level)
      ? payload.level
      : "info";
  task.updatedAt = nowIso();
  createTaskLog(task, text, level, peer.peerId);
  schedulePersist();
  broadcastSnapshot();
}

function finishTask(peer, payload) {
  const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
  const task = state.tasks.get(taskId);
  if (!task) {
    throw new Error("task not found");
  }
  if (task.assigneePeerId !== peer.peerId) {
    throw new Error("only assignee can finish task");
  }
  const status = payload.status === "failed" ? "failed" : "done";
  task.status = status;
  task.resultText = typeof payload.resultText === "string" ? payload.resultText.trim() : null;
  task.errorText = typeof payload.errorText === "string" ? payload.errorText.trim() : null;
  task.updatedAt = nowIso();
  if (status === "done") {
    createTaskLog(task, "Task completed.", "info", peer.peerId);
  } else {
    createTaskLog(task, task.errorText || "Task failed.", "error", peer.peerId);
  }
  schedulePersist();
  broadcastSnapshot();
}

function createExecRequest(peer, payload) {
  const taskId = typeof payload.taskId === "string" ? payload.taskId : "";
  const task = state.tasks.get(taskId);
  if (!task) {
    throw new Error("task not found");
  }
  if (task.assigneePeerId !== peer.peerId) {
    throw new Error("only assignee can request execution");
  }
  const ownerPeerId = task.ownerPeerId;
  if (!ownerPeerId) {
    throw new Error("task has no owner");
  }
  const requestId =
    typeof payload.requestId === "string" && payload.requestId.trim()
      ? payload.requestId.trim()
      : crypto.randomUUID();
  const command = typeof payload.command === "string" ? payload.command.trim() : "";
  if (!command) {
    throw new Error("command required");
  }
  state.pendingExec.set(requestId, {
    requestId,
    requesterPeerId: peer.peerId,
    ownerPeerId,
    taskId,
    createdAt: Date.now(),
  });
  pushEvent(
    {
      type: "exec_request",
      requestId,
      taskId,
      command,
      cwd: typeof payload.cwd === "string" ? payload.cwd : null,
      timeoutMs:
        typeof payload.timeoutMs === "number" && Number.isFinite(payload.timeoutMs)
          ? payload.timeoutMs
          : null,
    },
    ownerPeerId,
  );
}

function resolveExecResponse(peer, payload) {
  const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
  const pending = state.pendingExec.get(requestId);
  if (!pending) {
    return;
  }
  if (pending.ownerPeerId !== peer.peerId) {
    throw new Error("only owner can answer execution");
  }
  state.pendingExec.delete(requestId);
  pushEvent(
    {
      type: "exec_response",
      requestId,
      ok: payload.ok !== false,
      result: payload.result && typeof payload.result === "object" ? payload.result : null,
    },
    pending.requesterPeerId,
  );
}

function handleAction(peer, action) {
  switch (action?.type) {
    case "heartbeat":
      touchPeer(peer.peerId);
      return;
    case "create_task":
      createTaskFromAction(peer, action);
      return;
    case "claim_task":
      claimTask(peer, action);
      return;
    case "task_status":
      updateTaskStatus(peer, action);
      return;
    case "task_log":
      appendTaskLog(peer, action);
      return;
    case "task_finish":
      finishTask(peer, action);
      return;
    case "exec_request":
      createExecRequest(peer, action);
      return;
    case "exec_response":
      resolveExecResponse(peer, action);
      return;
    default:
      throw new Error("unknown action");
  }
}

function reapExpiredExecRequests() {
  const cutoff = Date.now() - EXEC_REQUEST_TIMEOUT_MS;
  for (const [requestId, pending] of state.pendingExec.entries()) {
    if (pending.createdAt > cutoff) {
      continue;
    }
    state.pendingExec.delete(requestId);
    pushEvent(
      {
        type: "exec_response",
        requestId,
        ok: false,
        result: {
          error: "owner execution timeout",
        },
      },
      pending.requesterPeerId,
    );
  }
}

setInterval(() => {
  cleanupStalePeers();
  reapExpiredExecRequests();
}, 10_000).unref();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      writeJson(res, 200, {
        ok: true,
        peers: Array.from(state.peers.values()).filter((peer) => peer.online).length,
        tasks: state.tasks.size,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/connect") {
      const body = await readJsonBody(req);
      if (!requireToken(body.token)) {
        writeJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      const peerId = typeof body.peerId === "string" && body.peerId.trim() ? body.peerId.trim() : "";
      if (!peerId) {
        writeJson(res, 400, { ok: false, error: "peerId required" });
        return;
      }
      touchPeer(peerId, {
        nickname:
          typeof body.nickname === "string" && body.nickname.trim() ? body.nickname.trim() : peerId,
        platform:
          typeof body.platform === "string" && body.platform.trim()
            ? body.platform.trim()
            : "unknown",
        version:
          typeof body.version === "string" && body.version.trim() ? body.version.trim() : "",
        executionContext:
          body.executionContext && typeof body.executionContext === "object"
            ? body.executionContext
            : null,
      });
      broadcastSnapshot();
      writeJson(res, 200, {
        ok: true,
        cursor: state.nextEventId - 1,
        snapshot: currentSnapshot(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/poll") {
      const token = url.searchParams.get("token") || "";
      const peerId = url.searchParams.get("peerId") || "";
      const cursor = Number.parseInt(url.searchParams.get("cursor") || "0", 10) || 0;
      if (!requireToken(token)) {
        writeJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      if (!peerId) {
        writeJson(res, 400, { ok: false, error: "peerId required" });
        return;
      }
      touchPeer(peerId);
      const ready = resolvePollEvents(peerId, cursor);
      if (ready.events.length > 0) {
        writeJson(res, 200, { ok: true, ...ready });
        return;
      }
      const delayed = await queueWaiter(peerId, cursor);
      writeJson(res, 200, { ok: true, ...delayed });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/action") {
      const body = await readJsonBody(req);
      if (!requireToken(body.token)) {
        writeJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      const peerId = typeof body.peerId === "string" ? body.peerId.trim() : "";
      if (!peerId) {
        writeJson(res, 400, { ok: false, error: "peerId required" });
        return;
      }
      const peer = touchPeer(peerId);
      handleAction(peer, body.action || {});
      writeJson(res, 200, { ok: true });
      return;
    }

    writeJson(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    writeJson(res, 500, { ok: false, error: error.message || String(error) });
  }
});

await loadState();
server.listen(PORT, HOST, () => {
  console.log(`ClawJobs hub listening on http://${HOST}:${PORT}`);
});
