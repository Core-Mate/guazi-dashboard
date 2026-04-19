# Dashboard E2E

Production E2E harness for the dashboard. The legacy [`lib.ts`](/Users/lishehao/Desktop/Project/Yihang/Mi/dashboard/e2e/lib.ts) and [`smoke.ts`](/Users/lishehao/Desktop/Project/Yihang/Mi/dashboard/e2e/smoke.ts) remain in place as references; active suites live in the new layout under `dashboard/e2e/`.

## Prerequisites

- `agent-browser` is installed and on `PATH`
- Google Chrome is installed locally
- `tsx` is available through `dashboard/package.json`
- Dashboard frontend and API are reachable for the selected environment

## Environment

Default local values come from [`env.sh`](/Users/lishehao/Desktop/Project/Yihang/Mi/dashboard/e2e/env.sh).

- `TEST_ENV=local` uses:
  - `E2E_FRONTEND_URL=http://localhost:8402`
  - `E2E_API_BASE=http://localhost:8403`
  - `E2E_API_KEY=dev-key-guazi-2026`
  - `E2E_TENANT_ID=1`
- `TEST_ENV=staging` and `TEST_ENV=prod` require explicit env vars.

You can export vars directly or create `dashboard/e2e/.env` from `.env.example`.

## Modes

- `api-smoke`: backend contract checks plus idempotency and cache timing
- `ui-smoke`: DOM-driven L1 interaction smoke suite
- `visual`: advisory Codex-powered screenshot checks
- `exploratory`: autonomous Codex exploration pass
- `pre-deploy`: `api-smoke` + `ui-smoke`
- `post-deploy`: `api-smoke` + `visual` + `exploratory`
- `all`: `api-smoke` + `ui-smoke` + `visual` + `exploratory`

## Usage

From `dashboard/`:

```bash
npm run e2e
npm run e2e:api
npm run e2e:ui
npm run e2e:visual
npm run e2e:explore
```

Or from the repo root:

```bash
bash dashboard/e2e/run.sh pre-deploy
```

## Prod Workflow

1. Export production env vars or populate `dashboard/e2e/.env`.
2. Run `TEST_ENV=prod npm run e2e:pre-deploy`.
3. Deploy the dashboard and API.
4. Run `TEST_ENV=prod npm run e2e:post-deploy`.

## Reports

Each dispatcher run uses a single `RUN_ID`. Reports are written to:

```text
dashboard/e2e/reports/{runId}/
```

Typical outputs:

- `api-smoke.md`
- `ui-smoke.md`
- `visual-smoke.md`
- `exploratory.md`
- screenshots captured by the TS suites
