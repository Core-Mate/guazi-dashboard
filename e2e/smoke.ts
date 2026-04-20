import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  type CodexVerdict,
  type StepResult,
  askCodexVisual,
  click,
  evalJson,
  findRef,
  hover,
  mouse,
  navigate,
  screenshot,
  setViewport,
  wait,
} from "./lib";

const BASE_URL = "http://localhost:8402/";
const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const screenshotDir = join("dashboard", "e2e", "screenshots", runId);
const reportPath = join("dashboard", "e2e", "reports", `${runId}.md`);
let authSessionPromise: Promise<{ token: string; user: Record<string, unknown> }> | null = null;

mkdirSync(screenshotDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

interface StepContext {
  screenshotPath: string;
  failureScreenshotPath: string;
  setVisual: (visual: CodexVerdict) => void;
}

interface StepMeta {
  visual?: CodexVerdict;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function resetViewport(width = DEFAULT_VIEWPORT.width, height = DEFAULT_VIEWPORT.height): Promise<void> {
  await setViewport(width, height);
  await wait(250);
}

async function getAuthSession(): Promise<{ token: string; user: Record<string, unknown> }> {
  if (authSessionPromise) {
    return authSessionPromise;
  }

  authSessionPromise = (async () => {
    const apiBase = process.env.E2E_API_BASE?.trim() || "http://localhost:8403";
    const phone = process.env.E2E_LOGIN_PHONE?.trim() || "13800138001";
    const code = process.env.E2E_LOGIN_CODE?.trim() || "123456";
    const response = await fetch(`${apiBase}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ phone, code }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.token || !body?.user) {
      throw new Error(`mock login failed: ${response.status} ${JSON.stringify(body)}`);
    }
    return {
      token: String(body.token),
      user: body.user as Record<string, unknown>,
    };
  })();

  return authSessionPromise;
}

async function seedDashboardAuth(): Promise<boolean> {
  const session = await getAuthSession();
  const userJson = JSON.stringify(session.user);

  const result = await evalJson<{ changed: boolean }>(`
    (() => {
      try {
        const token = ${JSON.stringify(session.token)};
        const user = ${JSON.stringify(userJson)};
        const changed = localStorage.getItem('authToken') !== token || localStorage.getItem('currentUser') !== user;
        localStorage.setItem('authToken', token);
        localStorage.setItem('currentUser', user);
        localStorage.removeItem('dashboardApiKey');
        localStorage.removeItem('dashboardTenantId');
        localStorage.removeItem('tenant_id');
        localStorage.removeItem('tenantId');
        return { changed };
      } catch {
        return { changed: false };
      }
    })()
  `);

  return result.changed;
}

async function waitForCondition(description: string, script: string, timeoutMs = 12000, intervalMs = 250): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const ready = await evalJson<boolean>(script);
    if (ready) {
      return;
    }
    await wait(intervalMs);
  }

  throw new Error(`${description} did not become ready within ${timeoutMs}ms`);
}

async function clickDom(script: string, failureMessage: string): Promise<void> {
  const clicked = await evalJson<boolean>(script);
  if (!clicked) {
    throw new Error(failureMessage);
  }
}

async function openDashboardHome(width = DEFAULT_VIEWPORT.width, height = DEFAULT_VIEWPORT.height): Promise<void> {
  await resetViewport(width, height);
  await navigate(BASE_URL);
  await wait(400);
  const reseeded = await seedDashboardAuth();
  if (reseeded) {
    await navigate(BASE_URL);
  }
  await waitForCondition(
    "dashboard overview",
    `(() => {
      const page = document.querySelector('#page-dashboard.active');
      const highlightGrid = document.getElementById('highlightGrid');
      return !!page && !!highlightGrid && highlightGrid.children.length > 0;
    })()`,
  );
}

async function openOpsDetails2D(): Promise<void> {
  await openDashboardHome();

  const opsRef = await findRef((r) => r.role === "button" && r.label.includes("运维"));
  await click(opsRef);
  await waitForCondition(
    "ops details panel",
    `(() => {
      const tab = document.getElementById('dashTab-ops');
      const chart = document.getElementById('opsTaskChart');
      const rect = chart ? chart.getBoundingClientRect() : null;
      return !!tab
        && tab.classList.contains('active')
        && !!chart
        && !!rect
        && rect.width > 200
        && rect.height > 100
        && !!document.querySelector('.chart-view-btn[data-view="2d"]')
        && !!document.querySelector('.chart-view-btn[data-view="ridge"]')
        && !!document.querySelector('.ops-view-switcher .seg-btn');
    })()`,
  );

  await clickDom(
    `(() => {
      const button = document.querySelector('.chart-view-btn[data-view="2d"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`,
    "Unable to switch ops details to 2D view",
  );
  await wait(600);
}

async function openOpsDetailTable(view: "tasks" | "accounts"): Promise<void> {
  await openOpsDetails2D();
  const label = view === "tasks" ? "任务" : "账号";

  await clickDom(
    `(() => {
      const buttons = Array.from(document.querySelectorAll('.ops-view-switcher .seg-btn'));
      const match = buttons.find((button) => String(button.textContent || '').includes(${JSON.stringify(label)}));
      if (!(match instanceof HTMLElement)) return false;
      match.click();
      return true;
    })()`,
    `Unable to switch ops details to ${label} tab`,
  );

  const rowSelector = view === "tasks" ? "tr[data-task-id]" : "tr[data-account-id]";
  await waitForCondition(
    `${label} table`,
    `(() => !!document.querySelector(${JSON.stringify(rowSelector)}))()`,
    12000,
    300,
  );
}

async function getOpsChartBox(): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await evalJson<{ x: number; y: number; width: number; height: number } | null>(`
    (() => {
      const el = document.getElementById('opsTaskChart');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()
  `);

  if (!box) {
    throw new Error("opsTaskChart not found");
  }

  return box;
}

async function readRangeCompareState(): Promise<{
  summaryExists: boolean;
  summaryVisible: boolean;
  summaryText: string;
  shadeDisplay: string;
  startDisplay: string;
  endDisplay: string;
}> {
  return evalJson(`
    (() => {
      const summary = document.querySelector('.range-compare-summary');
      const shade = document.querySelector('.select-shade');
      const startLine = document.querySelector('.select-line-start');
      const endLine = document.querySelector('.select-line-end');
      return {
        summaryExists: !!summary,
        summaryVisible: !!summary && summary.classList.contains('visible'),
        summaryText: summary ? String(summary.textContent || '').trim() : '',
        shadeDisplay: shade ? getComputedStyle(shade).display : 'missing',
        startDisplay: startLine ? getComputedStyle(startLine).display : 'missing',
        endDisplay: endLine ? getComputedStyle(endLine).display : 'missing',
      };
    })()
  `);
}

async function clickFirstRow(rowSelector: string, cardSelector: string): Promise<{
  beforeCount: number;
  afterCount: number;
  clicked: boolean;
  visible: boolean;
  cardText: string;
}> {
  return evalJson(`
    (() => {
      const beforeCount = document.querySelectorAll(${JSON.stringify(cardSelector)}).length;
      const row = document.querySelector(${JSON.stringify(rowSelector)});
      if (!row) {
        return { beforeCount, afterCount: beforeCount, clicked: false, visible: false, cardText: '' };
      }
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      const card = document.querySelector(${JSON.stringify(cardSelector)});
      return {
        beforeCount,
        afterCount: document.querySelectorAll(${JSON.stringify(cardSelector)}).length,
        clicked: true,
        visible: !!card && card.classList.contains('visible'),
        cardText: card ? String(card.textContent || '').trim().slice(0, 200) : '',
      };
    })()
  `);
}

async function runStep(
  name: string,
  action: (ctx: StepContext) => Promise<StepMeta | void>,
  visualCheck?: (screenshotPath: string) => Promise<CodexVerdict | undefined>,
): Promise<StepResult> {
  const started = new Date();
  const screenshotPath = join(screenshotDir, `${name}.png`);
  const failureScreenshotPath = join(screenshotDir, `${name}-FAIL.png`);
  let visual: CodexVerdict | undefined;

  console.log(`\n[step] ${name}`);

  try {
    const meta = await action({
      screenshotPath,
      failureScreenshotPath,
      setVisual: (nextVisual) => {
        visual = nextVisual;
      },
    });
    if (meta?.visual) {
      visual = meta.visual;
    }
    await screenshot(screenshotPath);

    if (!visual && visualCheck) {
      visual = await visualCheck(screenshotPath);
    }

    if (visual && !visual.pass) {
      throw new Error(`Visual: ${visual.reason}`);
    }

    const ended = new Date();
    return {
      name,
      ok: true,
      screenshot: screenshotPath,
      durationMs: ended.getTime() - started.getTime(),
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      visual,
    };
  } catch (error) {
    try {
      await screenshot(failureScreenshotPath);
    } catch (screenshotError) {
      console.error(`[warn] failed to capture failure screenshot for ${name}: ${formatError(screenshotError)}`);
    }

    const ended = new Date();
    return {
      name,
      ok: false,
      screenshot: failureScreenshotPath,
      durationMs: ended.getTime() - started.getTime(),
      startedAt: started.toISOString(),
      endedAt: ended.toISOString(),
      error: formatError(error),
      visual,
    };
  }
}

async function testLoadHome(): Promise<StepResult> {
  return runStep("01-load-home", async () => {
    await openDashboardHome();
  });
}

async function testRangeSwitch(): Promise<StepResult> {
  return runStep("02-range-switch", async () => {
    const ref = await findRef((r) => r.role === "button" && r.label.includes("昨日"));
    await click(ref);
    await wait(1000);
  });
}

async function testHighlightHover(): Promise<StepResult> {
  return runStep(
    "03-highlight-hover",
    async () => {
      const ref = await findRef((r) => r.label.includes("完成"));
      await hover(ref);
      await wait(1000);
    },
    async (shotPath) => askCodexVisual({
      image: shotPath,
      prompt:
        "This screenshot shows a dashboard metric card hover state. Check: (1) Is there a popout detail panel below the card showing sparkline curve plus daily average and peak numbers? (2) Is the popout fully visible without being clipped by the right menu or bottom edge? (3) Is the sparkline line crisp and clear not blurry? Return JSON: {pass: bool, reason: str, popout_visible: bool, sparkline_quality: good or blurry}",
    }),
  );
}

async function testOpsTab(): Promise<StepResult> {
  return runStep("04-ops-tab", async () => {
    const ref = await findRef((r) => r.role === "button" && r.label.includes("运维"));
    await click(ref);
    await wait(1500);
  });
}

async function test2dToRidgeline(): Promise<StepResult> {
  return runStep(
    "05-2d-to-ridgeline",
    async () => {
      const ref = await findRef((r) => r.role === "button" && r.label.includes("脊线"));
      await click(ref);
      await wait(1500);
    },
    async (shotPath) => askCodexVisual({
      image: shotPath,
      prompt:
        "This screenshot shows a ridgeline chart view. Check: (1) Are X-axis labels not overlapping (should be density-thinned)? (2) Does each metric curve occupy its own independent row? (3) Is the layout visually clean with no misalignment? Return JSON: {pass: bool, reason: str, axis_overlap: bool}",
    }),
  );
}

async function testExportPNG(): Promise<StepResult> {
  return runStep("06-export-png", async () => {
    const ref = await findRef(
      (r) => r.role === "button" && r.label.includes("导出") && r.label.toUpperCase().includes("PNG"),
    );
    await click(ref);
    await wait(2000);
  });
}

async function testRecordsTab(): Promise<StepResult> {
  return runStep("07-records-tab", async () => {
    const ref = await findRef((r) => r.role === "button" && r.label.includes("记录"));
    await click(ref);
    await wait(1500);
  });
}

async function testDragRangeCompare(): Promise<StepResult> {
  return runStep("08-drag-range-compare", async ({ screenshotPath, setVisual }) => {
    await openOpsDetails2D();

    const box = await getOpsChartBox();
    const startX = Math.round(box.x + box.width * 0.18);
    const endX = Math.round(box.x + box.width * 0.62);
    const midY = Math.round(box.y + box.height * 0.55);
    const dragShotPath = screenshotPath.replace(/\.png$/i, "-mid.png");
    let mouseIsDown = false;
    let visual: CodexVerdict | undefined;

    try {
      await mouse("move", startX, midY);
      await mouse("down", "left");
      mouseIsDown = true;
      await mouse("move", endX, midY);
      await wait(300);

      const midState = await readRangeCompareState();
      if (!midState.summaryVisible) {
        throw new Error("Range compare summary did not appear during drag");
      }
      if (midState.shadeDisplay !== "block" || midState.startDisplay !== "block" || midState.endDisplay !== "block") {
        throw new Error("Range selection markers were not visible during drag");
      }

      await screenshot(dragShotPath);
      visual = await askCodexVisual({
        image: dragShotPath,
        prompt:
          "This screenshot shows the user mid-drag selecting a range on the chart. Check: (1) Are there two vertical markers showing start and end? (2) Is there a semi-transparent overlay between them? (3) Is there a summary tooltip showing interval data? (4) Is the default tooltip suppressed? Return JSON: {pass: bool, reason: str}",
      });
      setVisual(visual);
      if (!visual.pass) {
        throw new Error(`Visual: ${visual.reason}`);
      }
    } finally {
      if (mouseIsDown) {
        try {
          await mouse("up", "left");
        } catch {
          // Preserve the original failure if mouse release itself fails.
        }
      }
    }

    await wait(300);
    const finalState = await readRangeCompareState();
    if (finalState.summaryVisible) {
      throw new Error("Range compare summary did not disappear after mouseup");
    }

    return { visual };
  });
}

async function testTaskClick(): Promise<StepResult> {
  return runStep("09-task-click", async () => {
    await openOpsDetailTable("tasks");
    const result = await clickFirstRow("tr[data-task-id]", "#task-detail-card");
    if (!result.clicked) {
      throw new Error("No task row found");
    }
    if (result.beforeCount !== 0) {
      throw new Error(`Expected no task detail card before click, found ${result.beforeCount}`);
    }
    if (result.afterCount <= result.beforeCount || !result.visible) {
      throw new Error(`Task detail card did not appear as a new visible node: ${JSON.stringify(result)}`);
    }
    await wait(1200);
  });
}

async function testAccountClick(): Promise<StepResult> {
  return runStep("10-account-click", async () => {
    await openOpsDetailTable("accounts");
    const result = await clickFirstRow("tr[data-account-id]", "#account-hover-card");
    if (!result.clicked) {
      throw new Error("No account row found");
    }
    if (result.beforeCount !== 0) {
      throw new Error(`Expected no account detail card before click, found ${result.beforeCount}`);
    }
    if (result.afterCount <= result.beforeCount || !result.visible) {
      throw new Error(`Account detail card did not appear as a new visible node: ${JSON.stringify(result)}`);
    }
    await wait(1200);
  });
}

async function testResponsive800(): Promise<StepResult> {
  return runStep("11-responsive-800", async () => {
    await openDashboardHome(800, 600);

    const ref = await findRef((r) => r.label.includes("完成"));
    await hover(ref);
    await wait(1000);

    const health = await evalJson<{ ready: boolean; title: string }>(`
      (() => ({
        ready: !!document.querySelector('#page-dashboard.active'),
        title: document.title || '',
      }))()
    `);
    if (!health.ready) {
      throw new Error("Dashboard did not finish rendering at 800x600");
    }
  });
}

function buildReport(results: StepResult[]): string {
  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  const lines = [
    `# E2E Smoke Report`,
    ``,
    `- Run ID: \`${runId}\``,
    `- Base URL: \`${BASE_URL}\``,
    `- Started: \`${results[0]?.startedAt ?? new Date().toISOString()}\``,
    `- Passed: \`${passed}\``,
    `- Failed: \`${failed}\``,
    ``,
    `| Step | Status | Visual | Duration (ms) | Screenshot | Error |`,
    `| --- | --- | --- | ---: | --- | --- |`,
    ...results.map((result) => {
      const status = result.ok ? "PASS" : "FAIL";
      const visual = result.visual ? (result.visual.pass ? "✅" : "❌") : "—";
      const shot = `\`${result.screenshot}\``;
      const error = result.error ? result.error.replace(/\|/g, "\\|").replace(/\n/g, "<br>") : "";
      return `| ${result.name} | ${status} | ${visual} | ${result.durationMs} | ${shot} | ${error} |`;
    }),
    ``,
  ];

  return lines.join("\n");
}

async function main(): Promise<void> {
  const steps = [
    testLoadHome,
    testRangeSwitch,
    testHighlightHover,
    testOpsTab,
    test2dToRidgeline,
    testExportPNG,
    testRecordsTab,
    testDragRangeCompare,
    testTaskClick,
    testAccountClick,
    testResponsive800,
  ];
  const results: StepResult[] = [];

  for (const step of steps) {
    const result = await step();
    results.push(result);

    const status = result.ok ? "PASS" : "FAIL";
    const visual = result.visual ? ` | visual=${result.visual.pass ? "PASS" : "FAIL"}` : "";
    console.log(`[result] ${status}${visual} ${result.name} (${result.durationMs}ms) -> ${result.screenshot}`);
    if (result.error) {
      console.log(result.error);
    }
  }

  writeFileSync(reportPath, buildReport(results), "utf8");

  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;

  console.log(`\nSmoke summary: ${passed}/${results.length} passed, ${failed} failed`);
  console.log(`Report: ${reportPath}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[fatal]", formatError(error));
  process.exitCode = 1;
});
