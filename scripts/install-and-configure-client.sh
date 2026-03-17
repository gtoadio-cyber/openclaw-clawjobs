#!/bin/zsh
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 <hub_url> <hub_token> <nickname> [workspace_dir]"
  exit 1
fi

HUB_URL="$1"
HUB_TOKEN="$2"
NICKNAME="$3"
WORKSPACE_DIR="${4:-$PWD}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/../plugin" && pwd)"

echo "Installing ClawJobs plugin from: $PLUGIN_DIR"
openclaw plugins install --link "$PLUGIN_DIR"

echo "Allowing plugin id: clawjobs"
openclaw config set plugins.allow '["clawjobs"]' --strict-json
openclaw config set plugins.entries.clawjobs.enabled true

CONFIG_JSON="$(cat <<JSON
{
  "hubUrl": "$HUB_URL",
  "hubToken": "$HUB_TOKEN",
  "nickname": "$NICKNAME",
  "workspaceDir": "$WORKSPACE_DIR",
  "execution": {
    "defaultCwd": "$WORKSPACE_DIR",
    "maxCommandMs": 30000,
    "maxOutputChars": 12000
  },
  "brain": {
    "maxSteps": 6,
    "timeoutMs": 90000
  }
}
JSON
)"

echo "Writing plugin config"
openclaw config set plugins.entries.clawjobs.config "$CONFIG_JSON" --strict-json

echo "Done."
echo "Now start OpenClaw:"
echo "  openclaw gateway run"
echo "Then open:"
echo "  http://127.0.0.1:18789/plugins/clawjobs"
