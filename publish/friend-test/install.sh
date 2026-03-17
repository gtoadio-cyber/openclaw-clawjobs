#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_FILE="$(find "$SCRIPT_DIR" -maxdepth 1 -name '*.tgz' -print0 | xargs -0 ls -1t 2>/dev/null | head -n 1)"
HUB_URL="${1:-${CLAWJOBS_HUB_URL:-}}"
HUB_TOKEN="${2:-${CLAWJOBS_HUB_TOKEN:-}}"
NICKNAME="${3:-${CLAWJOBS_NICKNAME:-$(scutil --get ComputerName 2>/dev/null || hostname -s || hostname || echo peer)}}"
WORKSPACE_DIR="${4:-${CLAWJOBS_WORKSPACE_DIR:-$HOME}}"
OPEN_URL="${CLAWJOBS_OPEN_URL:-1}"
START_GATEWAY="${CLAWJOBS_START_GATEWAY:-1}"
CONFIG_FILE="${OPENCLAW_CONFIG_FILE:-$HOME/.openclaw/openclaw.json}"
EXT_DIR="${OPENCLAW_EXT_DIR:-$HOME/.openclaw/extensions/clawjobs}"
BASE_ALLOW='[]'

if [ -z "$PACKAGE_FILE" ]; then
  echo "[ClawJobs] No .tgz package was found next to install.sh."
  exit 1
fi

if [ -z "$HUB_URL" ] || [ -z "$HUB_TOKEN" ]; then
  echo "Usage: sh install.sh <hub_url> <hub_token> [nickname] [workspace_dir]"
  exit 1
fi

if ! command -v openclaw >/dev/null 2>&1; then
  echo "[ClawJobs] openclaw CLI was not found."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[ClawJobs] node was not found."
  exit 1
fi

mkdir -p "$(dirname "$CONFIG_FILE")"

if [ -f "$CONFIG_FILE" ]; then
  PREP_OUTPUT="$(CONFIG_FILE="$CONFIG_FILE" node <<'NODE'
const fs = require('fs');
const configFile = process.env.CONFIG_FILE;
try {
  const raw = fs.readFileSync(configFile, 'utf8');
  const json = JSON.parse(raw);
  if (json && typeof json === 'object') {
    const plugins = json.plugins && typeof json.plugins === 'object' ? json.plugins : {};
    const allow = Array.isArray(plugins.allow) ? plugins.allow : [];
    const entries = plugins.entries && typeof plugins.entries === 'object' ? plugins.entries : {};
    const entryIds = Object.entries(entries)
      .filter(([, value]) => value && typeof value === 'object' && value.enabled !== false)
      .map(([key]) => key);
    const baseAllow = [...new Set([...allow.filter((item) => item !== 'clawjobs'), ...entryIds.filter((item) => item !== 'clawjobs')])];
    if (allow.includes('clawjobs')) {
      plugins.allow = allow.filter((item) => item !== 'clawjobs');
      json.plugins = plugins;
      fs.copyFileSync(configFile, `${configFile}.clawjobs.bak`);
      fs.writeFileSync(configFile, `${JSON.stringify(json, null, 2)}\n`);
      process.stdout.write('[ClawJobs] Cleared stale clawjobs allowlist residue.\n');
    }
    process.stdout.write(`__BASE_ALLOW__${JSON.stringify(baseAllow)}\n`);
  }
} catch {
  process.stdout.write('[ClawJobs] Skipped stale config repair because the config file is missing or invalid.\n');
}
NODE
)"
  printf '%s' "$PREP_OUTPUT" | sed '/^__BASE_ALLOW__/d'
  BASE_ALLOW="$(printf '%s' "$PREP_OUTPUT" | awk '/^__BASE_ALLOW__/ { sub("^__BASE_ALLOW__", ""); print }' | tail -n 1)"
  if [ -z "$BASE_ALLOW" ]; then
    BASE_ALLOW='[]'
  fi
fi

PACKAGE_VERSION="$(node -e 'const fs=require("fs");const os=require("os");const path=require("path");const cp=require("child_process");const archive=process.argv[1];const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"clawjobs-pkg-"));cp.execFileSync("tar",["-xzf",archive,"-C",tmp]);const pkg=JSON.parse(fs.readFileSync(path.join(tmp,"package","package.json"),"utf8"));fs.rmSync(tmp,{recursive:true,force:true});process.stdout.write(pkg.version||"0.0.0");' "$PACKAGE_FILE")"

printf '%s\n' "[ClawJobs] Installing plugin package via the official CLI: $PACKAGE_FILE"
set +e
INSTALL_OUTPUT="$(openclaw plugins install "$PACKAGE_FILE" 2>&1)"
INSTALL_STATUS=$?
set -e
printf '%s\n' "$INSTALL_OUTPUT"

if [ "$INSTALL_STATUS" -ne 0 ] && [ ! -f "$EXT_DIR/index.ts" ]; then
  echo "[ClawJobs] Official install failed before the extension files were written."
  exit "$INSTALL_STATUS"
fi

if [ "$INSTALL_STATUS" -ne 0 ]; then
  echo "[ClawJobs] Detected the current OpenClaw installer config timing bug; finishing setup with official config commands."
fi

MERGED_ALLOW="$(node -e '
const raw = process.argv[1] || "[]";
let list;
try { list = JSON.parse(raw); } catch { list = []; }
if (!Array.isArray(list)) list = [];
if (!list.includes("clawjobs")) list.push("clawjobs");
process.stdout.write(JSON.stringify(list));
' "$BASE_ALLOW")"

CONFIG_JSON="$(node - <<'NODE' "$HUB_URL" "$HUB_TOKEN" "$NICKNAME" "$WORKSPACE_DIR"
const [hubUrl, hubToken, nickname, workspaceDir] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  hubUrl,
  hubToken,
  nickname,
  workspaceDir,
  execution: {
    defaultCwd: workspaceDir,
    maxCommandMs: 30000,
    maxOutputChars: 12000,
  },
  brain: {
    maxSteps: 6,
    timeoutMs: 90000,
  },
}));
NODE
)"

INSTALL_JSON="$(node - <<'NODE' "$PACKAGE_FILE" "$EXT_DIR" "$PACKAGE_VERSION"
const [sourcePath, installPath, version] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  source: 'archive',
  sourcePath,
  installPath,
  version,
  installedAt: new Date().toISOString(),
}));
NODE
)"

openclaw config set plugins.allow "$MERGED_ALLOW" --strict-json >/dev/null
openclaw config set plugins.entries.clawjobs.enabled true >/dev/null
openclaw config set plugins.entries.clawjobs.config "$CONFIG_JSON" --strict-json >/dev/null
openclaw config set plugins.installs.clawjobs "$INSTALL_JSON" --strict-json >/dev/null
openclaw config validate >/dev/null

echo "[ClawJobs] Config written."
echo "[ClawJobs] Hub: $HUB_URL"
echo "[ClawJobs] Nickname: $NICKNAME"
echo "[ClawJobs] Workspace: $WORKSPACE_DIR"

PAGE_URL="http://127.0.0.1:18789/plugins/clawjobs"

if curl -fsS "$PAGE_URL" >/dev/null 2>&1; then
  echo "[ClawJobs] Gateway is already running."
else
  if [ "$START_GATEWAY" = "1" ]; then
    LOG_FILE="$HOME/.clawjobs-gateway.log"
    echo "[ClawJobs] Starting OpenClaw Gateway in the background..."
    nohup openclaw gateway run >"$LOG_FILE" 2>&1 &
    for _ in $(seq 1 20); do
      sleep 1
      if curl -fsS "$PAGE_URL" >/dev/null 2>&1; then
        echo "[ClawJobs] Gateway started."
        break
      fi
    done
  fi
fi

if curl -fsS "$PAGE_URL" >/dev/null 2>&1; then
  echo "[ClawJobs] Task page: $PAGE_URL"
  if [ "$OPEN_URL" = "1" ]; then
    open "$PAGE_URL" >/dev/null 2>&1 || true
  fi
else
  echo "[ClawJobs] Install finished, but the Gateway page is not reachable yet."
  echo "[ClawJobs] Start it manually with: openclaw gateway run"
  echo "[ClawJobs] Then open: $PAGE_URL"
fi
