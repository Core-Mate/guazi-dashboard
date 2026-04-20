# Playwright E2E

## Environment

- Frontend dev server must be reachable at `http://localhost:8402`.
- Backend API must be reachable at `http://localhost:8403`.
- Node.js and npm are required.
- Default local auth uses `E2E_API_KEY=dev-key-guazi-2026` and `E2E_TENANT_ID=1`.
- Override endpoints with `PLAYWRIGHT_FRONTEND_BASE_URL` and `PLAYWRIGHT_API_BASE_URL` when needed.

Recommended local startup:

```bash
cd dashboard
npm install
npm run dev
```

```bash
cd dashboard/api
./start.sh
```

## Run

Install the browser once:

```bash
cd dashboard
npx playwright install chromium
```

Run the full E2E stack:

```bash
cd dashboard
npm run test:e2e
```

Run by level:

```bash
cd dashboard
npm run test:e2e:l1
npm run test:e2e:l2
npm run test:e2e:l3
```

Useful one-off flags:

```bash
cd dashboard
npm run test:e2e -- --headed
npm run test:e2e:l3 -- --grep "pagination"
```

## Skip Behavior

- `l1-api.spec.ts` only requires the backend.
- `l2` and `l3` require both frontend and backend.
- If required services are not reachable, the suite marks the tests as `skipped` instead of hanging on long navigation timeouts.

## Artifacts And Baselines

- L2/L3 screenshots are artifacts only. They are not pixel baselines and do not gate pass/fail.
- Failure traces, screenshots, and videos are written by Playwright under `test-results/playwright/`.
- HTML report is available under `dashboard/playwright-report/` when the reporter is enabled.

Current baseline policy:

- No visual snapshot baseline needs regular refresh because the suite does not use `toHaveScreenshot()`.
- If a future spec adds screenshot assertions, refresh those baselines with:

```bash
cd dashboard
npx playwright test --update-snapshots
```

Or for a scoped refresh:

```bash
cd dashboard
npm run test:e2e:l2 -- --update-snapshots
```
