export function renderClawJobsPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ClawJobs</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0f1115;
        --panel: #171a21;
        --panel-2: #1d222c;
        --text: #e7ecf3;
        --muted: #9aa6b2;
        --line: #2a3140;
        --primary: #4ea1ff;
        --ok: #3fb950;
        --warn: #d29922;
        --err: #f85149;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      .page {
        max-width: 1440px;
        margin: 0 auto;
        padding: 20px;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 20px;
      }
      .title { font-size: 28px; font-weight: 700; }
      .subtitle, .muted { color: var(--muted); }
      .grid {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 16px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 16px;
      }
      .panel h3 {
        margin: 0 0 12px;
        font-size: 16px;
      }
      .stack { display: grid; gap: 12px; }
      textarea, input {
        width: 100%;
        background: var(--panel-2);
        color: var(--text);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px 12px;
      }
      textarea { min-height: 120px; resize: vertical; }
      .row {
        display: flex;
        gap: 12px;
        align-items: center;
      }
      button {
        background: var(--primary);
        color: white;
        border: none;
        border-radius: 10px;
        padding: 10px 14px;
        cursor: pointer;
        font-weight: 600;
      }
      button.secondary {
        background: transparent;
        border: 1px solid var(--line);
        color: var(--text);
      }
      button[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid var(--line);
      }
      .badge.ok { color: var(--ok); }
      .badge.warn { color: var(--warn); }
      .badge.err { color: var(--err); }
      .peer, .task {
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 12px;
        background: var(--panel-2);
      }
      .peer-title, .task-title {
        font-weight: 600;
        margin-bottom: 6px;
      }
      .task-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 8px 0;
      }
      .task pre, .logs pre {
        white-space: pre-wrap;
        word-break: break-word;
        margin: 0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
      }
      .columns {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
        margin-top: 16px;
      }
      .col-title {
        font-size: 14px;
        font-weight: 700;
        margin-bottom: 10px;
      }
      details {
        border-top: 1px solid var(--line);
        margin-top: 10px;
        padding-top: 10px;
      }
      summary { cursor: pointer; color: var(--muted); }
      .empty {
        border: 1px dashed var(--line);
        border-radius: 12px;
        padding: 14px;
        color: var(--muted);
      }
      @media (max-width: 1100px) {
        .grid, .columns {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="header">
        <div>
          <div class="title">ClawJobs</div>
          <div class="subtitle">Remote reasoning for OpenClaw, with real execution kept on the task owner's machine.</div>
        </div>
        <div id="conn"></div>
      </div>

      <div class="grid">
        <div class="panel stack">
          <h3>Create Task</h3>
          <textarea id="prompt" placeholder="Example: Inspect the slowest API path in this project and suggest optimizations."></textarea>
          <input id="cwd" placeholder="Working directory (defaults to your OpenClaw workspace)" />
          <div class="row">
            <button id="createBtn">Publish Task</button>
            <div class="muted" id="createMsg"></div>
          </div>
        </div>

        <div class="panel stack">
          <h3>Online Peers</h3>
          <div id="peers" class="stack"></div>
        </div>
      </div>

      <div class="columns">
        <div class="panel">
          <div class="col-title">Pending</div>
          <div id="tasks-pending" class="stack"></div>
        </div>
        <div class="panel">
          <div class="col-title">Running</div>
          <div id="tasks-running" class="stack"></div>
        </div>
        <div class="panel">
          <div class="col-title">Done</div>
          <div id="tasks-done" class="stack"></div>
        </div>
        <div class="panel">
          <div class="col-title">Failed</div>
          <div id="tasks-failed" class="stack"></div>
        </div>
      </div>
    </div>

    <script>
      let state = null;

      function statusBadge(task) {
        const cls =
          task.status === "done" ? "ok" :
          task.status === "failed" ? "err" :
          task.status === "pending" ? "warn" : "";
        return '<span class="badge ' + cls + '">' + task.status + '</span>';
      }

      function esc(value) {
        return String(value || "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
      }

      function apiUrl(suffix) {
        const base = window.location.pathname.replace(/\\/+$/, "");
        return base + suffix;
      }

      async function readJson(resp) {
        const text = await resp.text();
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          throw new Error(text || ('HTTP ' + resp.status));
        }
      }

      async function postJson(url, body) {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await readJson(resp);
        if (!resp.ok || json.ok === false) {
          throw new Error(json.error || "request failed");
        }
        return json;
      }

      function renderPeers(peers, selfPeerId) {
        const root = document.getElementById("peers");
        if (!peers || peers.length === 0) {
          root.innerHTML = '<div class="empty">No peers are online yet.</div>';
          return;
        }
        root.innerHTML = peers
          .map((peer) => {
            const exec = peer.executionContext || {};
            return '<div class="peer">' +
              '<div class="peer-title">' + esc(peer.nickname) + (peer.peerId === selfPeerId ? ' (You)' : '') + '</div>' +
              '<div class="muted">' + esc(peer.platform || '') + '</div>' +
              '<div class="task-meta">' +
                '<span class="badge ' + (peer.online ? 'ok' : 'err') + '">' + (peer.online ? 'online' : 'offline') + '</span>' +
              '</div>' +
              '<div class="muted">Default cwd: ' + esc(exec.defaultCwd || 'not set') + '</div>' +
              '<div class="muted">Shell: ' + esc(exec.shell || 'unknown') + '</div>' +
            '</div>';
          })
          .join("");
      }

      function renderTaskCard(task, selfPeerId) {
        const canClaim = task.status === "pending" && task.ownerPeerId !== selfPeerId;
        const logs = Array.isArray(task.logs) ? task.logs : [];
        return '<div class="task">' +
          '<div class="task-title">' + esc(task.prompt) + '</div>' +
          '<div class="task-meta">' +
            statusBadge(task) +
            '<span class="badge">Owner: ' + esc(task.ownerNickname || task.ownerPeerId) + '</span>' +
            (task.assigneeNickname ? '<span class="badge">Assignee: ' + esc(task.assigneeNickname) + '</span>' : '') +
          '</div>' +
          (task.workingDirectory ? '<div class="muted">Working directory: ' + esc(task.workingDirectory) + '</div>' : '') +
          (task.resultText ? '<details open><summary>Result</summary><pre>' + esc(task.resultText) + '</pre></details>' : '') +
          (task.errorText ? '<details open><summary>Failure</summary><pre>' + esc(task.errorText) + '</pre></details>' : '') +
          '<details><summary>Logs (' + logs.length + ')</summary><div class="logs"><pre>' +
            esc(logs.map((item) => '[' + item.ts + '] ' + item.text).join('\\n')) +
          '</pre></div></details>' +
          (canClaim ? '<div class="row" style="margin-top:10px"><button class="secondary" data-claim="' + esc(task.id) + '">Claim</button></div>' : '') +
        '</div>';
      }

      function renderTasks(tasks, selfPeerId) {
        const groups = {
          pending: [],
          running: [],
          done: [],
          failed: [],
        };
        for (const task of tasks || []) {
          if (task.status === "pending") groups.pending.push(task);
          else if (task.status === "claimed" || task.status === "running") groups.running.push(task);
          else if (task.status === "done") groups.done.push(task);
          else if (task.status === "failed") groups.failed.push(task);
        }

        for (const [key, list] of Object.entries(groups)) {
          const root = document.getElementById("tasks-" + key);
          root.innerHTML = list.length
            ? list.map((task) => renderTaskCard(task, selfPeerId)).join("")
            : '<div class="empty">Nothing here yet.</div>';
        }

        document.querySelectorAll("[data-claim]").forEach((button) => {
          button.onclick = async () => {
            const taskId = button.getAttribute("data-claim");
            try {
              await postJson(apiUrl("/api/claim-task"), { taskId });
            } catch (error) {
              alert(error.message || String(error));
            }
          };
        });
      }

      function renderConnection(info) {
        const root = document.getElementById("conn");
        const connected = info.connected;
        root.innerHTML =
          '<div class="badge ' + (connected ? 'ok' : 'err') + '">' + (connected ? 'Hub connected' : 'Hub disconnected') + '</div>' +
          '<div class="muted" style="margin-top:8px">Local peer: ' + esc(info.nickname || info.peerId || '') + '</div>' +
          '<div class="muted">Hub: ' + esc(info.hubUrl || '') + '</div>' +
          (info.lastError ? '<div class="muted" style="max-width:420px">' + esc(info.lastError) + '</div>' : '');
      }

      function render(nextState) {
        state = nextState;
        renderConnection(nextState.connection);
        renderPeers(nextState.peers || [], nextState.self.peerId);
        renderTasks(nextState.tasks || [], nextState.self.peerId);
      }

      async function loadState() {
        const resp = await fetch(apiUrl("/api/state"));
        const json = await readJson(resp);
        render(json);
      }

      document.getElementById("createBtn").onclick = async () => {
        const prompt = document.getElementById("prompt").value.trim();
        const workingDirectory = document.getElementById("cwd").value.trim();
        const msg = document.getElementById("createMsg");
        msg.textContent = "";
        try {
          await postJson(apiUrl("/api/create-task"), {
            prompt,
            workingDirectory,
          });
          document.getElementById("prompt").value = "";
          msg.textContent = "Published";
        } catch (error) {
          msg.textContent = error.message || String(error);
        }
      };

      loadState();
      const source = new EventSource(apiUrl("/api/events"));
      source.onmessage = (event) => {
        try {
          render(JSON.parse(event.data));
        } catch (error) {
          console.warn(error);
        }
      };
    </script>
  </body>
</html>`;
}
