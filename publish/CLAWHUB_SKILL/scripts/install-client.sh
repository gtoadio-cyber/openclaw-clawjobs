#!/bin/zsh
set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "Usage: $0 <plugin_npm_spec> <hub_url> <hub_token> <nickname> [workspace_dir]"
  exit 1
fi

PLUGIN_SPEC="$1"
HUB_URL="$2"
HUB_TOKEN="$3"
NICKNAME="$4"
WORKSPACE_DIR="${5:-$PWD}"
CONFIG_FILE="${OPENCLAW_CONFIG_FILE:-$HOME/.openclaw/openclaw.json}"
EXT_DIR="${OPENCLAW_EXT_DIR:-$HOME/.openclaw/extensions/clawjobs}"
BASE_ALLOW='[]'

if ! command -v openclaw >/dev/null 2>&1; then
  echo "openclaw CLI not found"
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
    }
    process.stdout.write(`__BASE_ALLOW__${JSON.stringify(baseAllow)}\n`);
  }
} catch {}
NODE
)"
  printf '%s' "$PREP_OUTPUT" | sed '/^__BASE_ALLOW__/d'
  BASE_ALLOW="$(printf '%s' "$PREP_OUTPUT" | awk '/^__BASE_ALLOW__/ { sub("^__BASE_ALLOW__", ""); print }' | tail -n 1)"
  if [ -z "$BASE_ALLOW" ]; then
    BASE_ALLOW='[]'
  fi
fi

echo "Installing ClawJobs plugin via official CLI: $PLUGIN_SPEC"
set +e
INSTALL_OUTPUT="$(openclaw plugins install "$PLUGIN_SPEC" 2>&1)"
INSTALL_STATUS=$?
set -e
printf '%s\n' "$INSTALL_OUTPUT"

if [ "$INSTALL_STATUS" -ne 0 ] && [ ! -f "$EXT_DIR/index.ts" ]; then
  echo "OpenClaw plugin install failed before files were written"
  exit "$INSTALL_STATUS"
fi

if [ "$INSTALL_STATUS" -ne 0 ]; then
  echo "Detected the current OpenClaw installer config timing bug; finishing setup with official config commands."
fi

PACKAGE_VERSION="$(node -e 'const fs=require("fs"); const p=process.argv[1]; const pkg=JSON.parse(fs.readFileSync(p,"utf8")); process.stdout.write(pkg.version || "0.0.0");' "$EXT_DIR/package.json")"

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

INSTALL_JSON="$(node - <<'NODE' "$PLUGIN_SPEC" "$EXT_DIR" "$PACKAGE_VERSION"
const [sourcePath, installPath, version] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  source: sourcePath.startsWith('@') ? 'npm' : 'archive',
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

echo "ClawJobs installed and configured."
echo "Open the task page after gateway starts:"
echo "  http://127.0.0.1:18789/plugins/clawjobs"
