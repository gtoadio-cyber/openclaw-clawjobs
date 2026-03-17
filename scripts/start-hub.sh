#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HUB_DIR="$(cd "$SCRIPT_DIR/../hub" && pwd)"

: "${CLAWJOBS_TOKEN:=clawjobs-20260317}"
: "${CLAWJOBS_HOST:=0.0.0.0}"
: "${CLAWJOBS_PORT:=19888}"

cd "$HUB_DIR"
echo "Starting ClawJobs hub on http://${CLAWJOBS_HOST}:${CLAWJOBS_PORT}"
echo "Token: ${CLAWJOBS_TOKEN}"
exec env \
  CLAWJOBS_TOKEN="$CLAWJOBS_TOKEN" \
  CLAWJOBS_HOST="$CLAWJOBS_HOST" \
  CLAWJOBS_PORT="$CLAWJOBS_PORT" \
  node server.js
