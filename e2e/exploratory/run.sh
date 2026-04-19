#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$ROOT"

if [[ -z "${E2E_API_BASE:-}" ]]; then
  source "$SCRIPT_DIR/../env.sh" 2>/dev/null || true
else
  source dashboard/e2e/env.sh
fi

API_BASE="${E2E_API_BASE:-http://localhost:8403}"
AGENT_BROWSER_URL="${E2E_EXPLORATORY_AGENT_BROWSER_URL:-http://localhost:8765}"
CDP_PORT="${E2E_CHROME_PORT:-${E2E_CDP_PORT:-9222}}"
if [[ -n "${E2E_CDP_PORT:-}" ]] && [[ -z "${E2E_CHROME_PORT:-}" ]]; then
  echo "[e2e] warning: E2E_CDP_PORT is deprecated, use E2E_CHROME_PORT" >&2
fi
E2E_RUN_ID="${E2E_RUN_ID:-${RUN_ID:-$(date +%s)}}"
E2E_REPORT_DIR="${E2E_REPORT_DIR:-${REPORT_DIR:-dashboard/e2e/reports/$E2E_RUN_ID}}"
E2E_EXPLORATORY_PROMPT_FILE="${E2E_EXPLORATORY_PROMPT_FILE:-dashboard/e2e/exploratory/prompt.md}"
EXPLORATORY_TIMEOUT_SEC="${E2E_EXPLORATORY_TIMEOUT_SEC:-600}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '[e2e] missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

check_http() {
  local name="$1"
  local url="$2"
  if ! curl -fsS --max-time 5 "$url" >/dev/null; then
    printf '[e2e] %s is not reachable: %s\n' "$name" "$url" >&2
    exit 1
  fi
}

check_agent_browser_connect() {
  python3 - "$CDP_PORT" <<'PY'
import subprocess
import sys

port = sys.argv[1]
try:
    subprocess.run(
        ["agent-browser", "connect", port],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        timeout=10,
    )
except subprocess.TimeoutExpired:
    print(f"[e2e] agent-browser connect timed out on CDP port {port}", file=sys.stderr)
    raise SystemExit(1)
except subprocess.CalledProcessError as exc:
    details = (exc.stderr or "").strip()
    if details:
        print(f"[e2e] agent-browser connect failed on CDP port {port}: {details}", file=sys.stderr)
    else:
        print(f"[e2e] agent-browser connect failed on CDP port {port}", file=sys.stderr)
    raise SystemExit(1)
PY
}

require_cmd curl
require_cmd python3
require_cmd codex
require_cmd agent-browser

check_http "backend health" "$API_BASE/health"
check_http "agent-browser service" "$AGENT_BROWSER_URL"
check_http "Chrome CDP" "http://127.0.0.1:$CDP_PORT/json/version"
check_agent_browser_connect

REPORT_PATH="$E2E_REPORT_DIR/exploratory.md"
mkdir -p "$E2E_REPORT_DIR"
PROMPT=$(sed \
  -e "s|\$FRONTEND_URL|$E2E_FRONTEND_URL|g" \
  -e "s|\$REPORT_DIR|$E2E_REPORT_DIR|g" \
  -e "s|\$E2E_MAX_EXPLORATORY_STEPS|${E2E_MAX_EXPLORATORY_STEPS:-30}|g" \
  "$E2E_EXPLORATORY_PROMPT_FILE")
PROMPT="$PROMPT

Use high-effort reasoning and finish by writing the markdown report file directly."

TMP_PROMPT="$(mktemp)"
printf '%s\n' "$PROMPT" >"$TMP_PROMPT"

python3 - "$TMP_PROMPT" "$E2E_REPORT_DIR" "$EXPLORATORY_TIMEOUT_SEC" <<'PY'
import pathlib
import subprocess
import sys

prompt_path = pathlib.Path(sys.argv[1])
report_dir = pathlib.Path(sys.argv[2])
timeout_sec = int(sys.argv[3])
prompt = prompt_path.read_text(encoding="utf-8")

try:
    subprocess.run(
        ["codex", "exec", "--model", "gpt-5.4", "--sandbox", "danger-full-access", prompt],
        check=True,
        timeout=timeout_sec,
    )
except subprocess.TimeoutExpired:
    report_path = report_dir / "exploratory.md"
    if not report_path.exists():
      report_path.write_text(
          "# Exploratory\n\n- 🟡 warning: exploratory Codex run timed out before producing a report.\n",
          encoding="utf-8",
      )
    print(f"[e2e] exploratory timed out after {timeout_sec}s; wrote fallback report", file=sys.stderr)
except subprocess.CalledProcessError:
    raise
finally:
    prompt_path.unlink(missing_ok=True)
PY

if [[ ! -f "$REPORT_PATH" ]]; then
  printf '[e2e] exploratory run finished without producing %s\n' "$REPORT_PATH" >&2
  exit 1
fi

if grep -Fq "exploratory Codex run timed out before producing a report" "$REPORT_PATH"; then
  printf '[e2e] exploratory run produced fallback report: %s\n' "$REPORT_PATH" >&2
  exit 1
fi

echo "Exploratory report: $REPORT_PATH"
