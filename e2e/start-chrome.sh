#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PORT="${E2E_CHROME_PORT:-9222}"
PROFILE_DIR="${E2E_CHROME_PROFILE_DIR:-/tmp/dashboard-agent-browser-cdp}"
LOG_PATH="${E2E_CHROME_LOG_PATH:-/tmp/dashboard-e2e-chrome.log}"
CHROME_BIN="${E2E_CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[e2e] missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd lsof
require_cmd agent-browser

if [[ ! -x "$CHROME_BIN" ]]; then
  printf '[e2e] Chrome binary not found: %s\n' "$CHROME_BIN" >&2
  exit 1
fi

if pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)" && [[ -n "$pids" ]]; then
  printf '[e2e] killing existing process on CDP port %s: %s\n' "$PORT" "$pids"
  kill $pids >/dev/null 2>&1 || true
  sleep 1
  if pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null)" && [[ -n "$pids" ]]; then
    kill -9 $pids >/dev/null 2>&1 || true
    sleep 1
  fi
fi

mkdir -p "$PROFILE_DIR"
rm -f "$LOG_PATH"

"$CHROME_BIN" \
  --headless=new \
  --disable-gpu \
  --disable-dev-shm-usage \
  --no-first-run \
  --no-default-browser-check \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  about:blank >"$LOG_PATH" 2>&1 &

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    agent-browser connect "$PORT" >/dev/null
    printf '[e2e] Chrome CDP ready on :%s and agent-browser connected\n' "$PORT"
    exit 0
  fi
  sleep 0.5
done

printf '[e2e] Chrome CDP failed to start on :%s\n' "$PORT" >&2
if [[ -f "$LOG_PATH" ]]; then
  tail -50 "$LOG_PATH" >&2 || true
fi
exit 1
