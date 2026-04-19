#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

source dashboard/e2e/env.sh

RUN_ID="${RUN_ID:-$(date -u +'%Y%m%dT%H%M%SZ')}"
REPORT_DIR="dashboard/e2e/reports/$RUN_ID"
mkdir -p "$REPORT_DIR"
PROMPT=$(cat dashboard/e2e/exploratory/prompt.md | \
  sed "s|\$FRONTEND_URL|$E2E_FRONTEND_URL|g" | \
  sed "s|\$REPORT_DIR|$REPORT_DIR|g" | \
  sed "s|\$E2E_MAX_EXPLORATORY_STEPS|${E2E_MAX_EXPLORATORY_STEPS:-30}|g")
PROMPT="$PROMPT

Use high-effort reasoning and finish by writing the markdown report file directly."

TMP_PROMPT="$(mktemp)"
printf '%s\n' "$PROMPT" >"$TMP_PROMPT"

python3 - "$TMP_PROMPT" "$REPORT_DIR" "${E2E_EXPLORATORY_TIMEOUT_SEC:-120}" <<'PY'
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

echo "Exploratory report: $REPORT_DIR/exploratory.md"
