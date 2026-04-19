#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/../.."

if [[ -f dashboard/e2e/.env ]]; then
  set -a
  source dashboard/e2e/.env
  set +a
fi

MODE="${1:-smoke}"
export RUN_ID="${RUN_ID:-$(date -u +'%Y%m%dT%H%M%SZ')}"
source dashboard/e2e/env.sh

run_ts() {
  npx --prefix dashboard tsx "$1"
}

case "$MODE" in
  api-smoke)       bash dashboard/e2e/api-smoke.sh ;;
  ui-smoke|smoke)  bash dashboard/e2e/start-chrome.sh; run_ts dashboard/e2e/ui-smoke.ts ;;
  visual)          bash dashboard/e2e/start-chrome.sh; run_ts dashboard/e2e/visual-smoke.ts ;;
  exploratory|explore) bash dashboard/e2e/start-chrome.sh; bash dashboard/e2e/exploratory/run.sh ;;
  pre-deploy)      bash dashboard/e2e/api-smoke.sh; bash dashboard/e2e/start-chrome.sh; run_ts dashboard/e2e/ui-smoke.ts ;;
  post-deploy|full) bash dashboard/e2e/api-smoke.sh; bash dashboard/e2e/start-chrome.sh; run_ts dashboard/e2e/visual-smoke.ts; bash dashboard/e2e/exploratory/run.sh ;;
  all)             bash dashboard/e2e/api-smoke.sh; bash dashboard/e2e/start-chrome.sh; run_ts dashboard/e2e/ui-smoke.ts; run_ts dashboard/e2e/visual-smoke.ts; bash dashboard/e2e/exploratory/run.sh ;;
  *)               echo "Usage: $0 {api-smoke|ui-smoke|visual|exploratory|pre-deploy|post-deploy|all}" >&2; exit 1 ;;
esac
