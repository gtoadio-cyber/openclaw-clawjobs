#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HUB_DIR="$SCRIPT_DIR"

: "${CLAWJOBS_HOST:=0.0.0.0}"
: "${CLAWJOBS_PORT:=19888}"

if [ -z "${CLAWJOBS_TOKEN:-}" ]; then
  echo "CLAWJOBS_TOKEN is required"
  exit 1
fi

cd "$HUB_DIR"
echo "Starting ClawJobs hub on http://${CLAWJOBS_HOST}:${CLAWJOBS_PORT}"
exec env \
  CLAWJOBS_TOKEN="$CLAWJOBS_TOKEN" \
  CLAWJOBS_HOST="$CLAWJOBS_HOST" \
  CLAWJOBS_PORT="$CLAWJOBS_PORT" \
  node server.js
