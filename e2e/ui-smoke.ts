import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
  DEFAULT_BASE_URL,
  click,
  evalJson,
  findRef,
  hover,
  mouse,
  navigate,
  screenshot,
  setViewport,
  wait,
} from "./lib/browser";
import { appendRow, finalizeReport, initReport } from "./lib/report";

const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const RUN_ID = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
const BASE_URL = DEFAULT_BASE_URL.endsWith("/") ? DEFAULT_BASE_URL : `${DEFAULT_BASE_URL}/`;
const reportPath = initReport(RUN_ID, "ui-smoke");
const artifactDir = join(dirname(reportPath), "ui-smoke-artifacts");

mkdirSync(artifactDir, { recursive: true });

type ResultMark = "✅" | "❌";

interface TestContext {
  screenshotPath: string;
  failureScreenshotPath: string;
}

interface TestMeta {
  detail?: string;
  screenshotPath?: string;
}

interface TestResult {
  name: string;
  result: ResultMark;
  detail: string;
  screenshot: string;
  durationMs: number;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function rel(path: string): string {
  return relative(process.cwd(), path) || path;
}

function shot(name: string): string {
  return join(artifactDir, `${name}.png`);
}

async function waitForCondition(description: string, script: string, timeoutMs = 12000, intervalMs = 250): Promise<void> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    try {
      const ready = await evalJson<boolean>(script);
      if (ready) {
        return;
      }
    } catch {
      // Ignore transient eval failures during navigation and continue polling.
    }
    await wait(intervalMs);
  }

  throw new Error(`${description} did not become ready within ${timeoutMs}ms`);
}

async function resetViewport(width = DEFAULT_VIEWPORT.width, height = DEFAULT_VIEWPORT.height): Promise<void> {
  await setViewport(width, height);
  await wait(250);
}

async function seedDashboardAuth(): Promise<boolean> {
  const apiKey = process.env.E2E_API_KEY?.trim();
  const tenantId = process.env.E2E_TENANT_ID?.trim() || "1";
  if (!apiKey) {
    return false;
  }

  return evalJson<boolean>(`
    (() => {
      const changed =
        localStorage.getItem("dashboardApiKey") !== ${JSON.stringify(apiKey)} ||
        localStorage.getItem("dashboardTenantId") !== ${JSON.stringify(tenantId)};
      localStorage.setItem("dashboardApiKey", ${JSON.stringify(apiKey)});
      localStorage.setItem("dashboardTenantId", ${JSON.stringify(tenantId)});
      return changed;
    })()
  `);
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
    await wait(400);
  }

  await waitForCondition(
    "dashboard overview",
    `(() => {
      const page = document.querySelector("#page-dashboard.active");
      const grid = document.getElementById("highlightGrid");
      return !!page && !!grid && grid.children.length > 0 && !!window.__lastSnap;
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
      const tab = document.getElementById("dashTab-ops");
      const chart = document.getElementById("opsTaskChart");
      const rect = chart ? chart.getBoundingClientRect() : null;
      return !!tab
        && tab.classList.contains("active")
        && !!chart
        && !!rect
        && rect.width > 200
        && rect.height > 100;
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
      const buttons = Array.from(document.querySelectorAll(".ops-view-switcher .seg-btn"));
      const match = buttons.find((button) => String(button.textContent || "").includes(${JSON.stringify(label)}));
      if (!(match instanceof HTMLElement)) return false;
      match.click();
      return true;
    })()`,
    `Unable to switch ops details to ${label} tab`,
  );

  const rowSelector = view === "tasks" ? "tr[data-task-id]" : "tr[data-account-id]";
  await waitForCondition(`${label} table`, `(() => !!document.querySelector(${JSON.stringify(rowSelector)}))()`);
}

async function getOpsChartBox(): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await evalJson<{ x: number; y: number; width: number; height: number } | null>(`
    (() => {
      const el = document.getElementById("opsTaskChart");
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
  summaryVisible: boolean;
  summaryText: string;
  shadeDisplay: string;
  startDisplay: string;
  endDisplay: string;
}> {
  return evalJson(`
    (() => {
      const summary = document.querySelector(".range-compare-summary");
      const shade = document.querySelector(".select-shade");
      const startLine = document.querySelector(".select-line-start");
      const endLine = document.querySelector(".select-line-end");
      return {
        summaryVisible: !!summary && summary.classList.contains("visible"),
        summaryText: summary ? String(summary.textContent || "").trim() : "",
        shadeDisplay: shade ? getComputedStyle(shade).display : "missing",
        startDisplay: startLine ? getComputedStyle(startLine).display : "missing",
        endDisplay: endLine ? getComputedStyle(endLine).display : "missing",
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
        return { beforeCount, afterCount: beforeCount, clicked: false, visible: false, cardText: "" };
      }
      row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      const card = document.querySelector(${JSON.stringify(cardSelector)});
      return {
        beforeCount,
        afterCount: document.querySelectorAll(${JSON.stringify(cardSelector)}).length,
        clicked: true,
        visible: !!card && card.classList.contains("visible"),
        cardText: card ? String(card.textContent || "").trim().slice(0, 200) : "",
      };
    })()
  `);
}

async function installDownloadSpy(): Promise<void> {
  await evalJson<boolean>(`
    (() => {
      window.__e2eDownloads = [];
      if (window.__e2eDownloadSpyInstalled) return true;
      const proto = HTMLAnchorElement.prototype;
      const original = proto.click;
      proto.click = function(...args) {
        try {
          const href = this.href || "";
          const download = this.download || "";
          if (href || download) {
            window.__e2eDownloads.push({ href, download });
          }
        } catch {}
        return original.apply(this, args);
      };
      window.__e2eDownloadSpyInstalled = true;
      return true;
    })()
  `);
}

async function readDownloads(): Promise<Array<{ href: string; download: string }>> {
  return evalJson(`
    (() => Array.isArray(window.__e2eDownloads) ? window.__e2eDownloads.slice() : [])()
  `);
}

async function runTest(
  name: string,
  check: (ctx: TestContext) => Promise<string | TestMeta | void>,
): Promise<TestResult> {
  const startedAt = Date.now();
  const screenshotPath = shot(name);
  const failureScreenshotPath = shot(`${name}-FAIL`);

  try {
    const meta = await check({ screenshotPath, failureScreenshotPath });
    const detail = typeof meta === "string"
      ? meta
      : (meta && typeof meta === "object" && "detail" in meta ? meta.detail || "ok" : "ok");
    const finalShot = typeof meta === "object" && meta?.screenshotPath ? meta.screenshotPath : screenshotPath;

    if (!existsSync(finalShot)) {
      await screenshot(finalShot);
    }

    const result: TestResult = {
      name,
      result: "✅",
      detail,
      screenshot: finalShot,
      durationMs: Date.now() - startedAt,
    };

    appendRow(reportPath, name, result.result, `${detail}; screenshot=\`${rel(finalShot)}\`; duration=${result.durationMs}ms`);
    console.log(`[ui-smoke] ✅ ${name} (${result.durationMs}ms) -> ${rel(finalShot)}`);
    return result;
  } catch (error) {
    const detail = formatError(error);
    try {
      await screenshot(failureScreenshotPath);
    } catch {
      // Ignore secondary screenshot failures so the original error is preserved.
    }

    const result: TestResult = {
      name,
      result: "❌",
      detail,
      screenshot: failureScreenshotPath,
      durationMs: Date.now() - startedAt,
    };

    appendRow(reportPath, name, result.result, `${detail}; screenshot=\`${rel(failureScreenshotPath)}\`; duration=${result.durationMs}ms`);
    console.log(`[ui-smoke] ❌ ${name} (${result.durationMs}ms) -> ${detail}`);
    return result;
  }
}

async function testLoad({ screenshotPath }: TestContext): Promise<TestMeta> {
  await openDashboardHome();
  const state = await evalJson<{ cards: number; title: string }>(`
    (() => ({
      cards: document.querySelectorAll("#highlightGrid .highlight-card").length,
      title: document.title || ""
    }))()
  `);
  if (state.cards < 4) {
    throw new Error(`Expected highlight cards, found ${state.cards}`);
  }
  return { detail: `loaded dashboard with ${state.cards} highlight cards`, screenshotPath };
}

async function testRangeSwitch({ screenshotPath }: TestContext): Promise<TestMeta> {
  await openDashboardHome();
  const ref = await findRef((r) => r.role === "button" && r.label.includes("昨日"));
  await click(ref);
  await waitForCondition(
    "yesterday range",
    `(() => window.__lastSnap && window.__lastSnap.range === "yesterday")()`,
  );
  const state = await evalJson<{ range: string; activeLabel: string }>(`
    (() => {
      const active = document.querySelector("#page-dashboard .toolbar .toolbar-btn.active");
      return {
        range: window.__lastSnap ? String(window.__lastSnap.range || "") : "",
        activeLabel: active ? String(active.textContent || "").trim() : ""
      };
    })()
  `);
  if (state.range !== "yesterday") {
    throw new Error(`Expected range=yesterday, got ${state.range || "<empty>"}`);
  }
  return { detail: `active range=${state.range} label=${state.activeLabel || "<none>"}`, screenshotPath };
}

async function testHover({ screenshotPath }: TestContext): Promise<TestMeta> {
  await openDashboardHome();
  const ref = await findRef((r) => r.label.includes("完成"));
  await hover(ref);
  await waitForCondition(
    "highlight popout",
    `(() => {
      const popout = document.querySelector(".highlight-popout-floating.visible");
      return !!popout && String(popout.textContent || "").trim().length > 0;
    })()`,
  );
  const state = await evalJson<{ visible: boolean; text: string; canvasCount: number }>(`
    (() => {
      const popout = document.querySelector(".highlight-popout-floating.visible");
      return {
        visible: !!popout,
        text: popout ? String(popout.textContent || "").trim().slice(0, 120) : "",
        canvasCount: popout ? popout.querySelectorAll("canvas").length : 0
      };
    })()
  `);
  if (!state.visible || state.canvasCount < 1) {
    throw new Error(`Hover popout missing expected content: ${JSON.stringify(state)}`);
  }
  return { detail: `popout visible with ${state.canvasCount} canvas element(s)`, screenshotPath };
}

async function testOpsSection({ screenshotPath }: TestContext): Promise<TestMeta> {
  await openOpsDetails2D();
  const state = await evalJson<{ active: boolean; width: number; height: number; toggleCount: number }>(`
    (() => {
      const tab = document.getElementById("dashTab-ops");
      const chart = document.getElementById("opsTaskChart");
      const rect = chart ? chart.getBoundingClientRect() : { width: 0, height: 0 };
      return {
        active: !!tab && tab.classList.contains("active"),
        width: Math.round(rect.width || 0),
        height: Math.round(rect.height || 0),
        toggleCount: document.querySelectorAll(".chart-view-btn").length
      };
    })()
  `);
  if (!state.active || state.width < 200 || state.height < 100) {
    throw new Error(`Ops section not ready: ${JSON.stringify(state)}`);
  }
  return { detail: `ops chart ${state.width}x${state.height} with ${state.toggleCount} view toggle(s)`, screenshotPath };
}

async function testRidgeline({ screenshotPath }: TestContext): Promise<TestMeta> {
  await openOpsDetails2D();
  const ref = await findRef((r) => r.role === "button" && r.label.includes("脊线"));
  await click(ref);
  await waitForCondition(
    "ridgeline view",
    `(() => {
      const ctn = document.getElementById("opsRidgelineContainer");
      const svg = ctn ? ctn.querySelector("svg") : null;
      return !!ctn && ctn.style.display !== "none" && !!svg;
    })()`,
  );
  const state = await evalJson<{ display: string; svg: boolean; pathCount: number; textCount: number }>(`
    (() => {
      const ctn = document.getElementById("opsRidgelineContainer");
      const svg = ctn ? ctn.querySelector("svg") : null;
      return {
        display: ctn ? getComputedStyle(ctn).display : "missing",
        svg: !!svg,
        pathCount: svg ? svg.querySelectorAll("path").length : 0,
        textCount: svg ? svg.querySelectorAll("text").length : 0
      };
    })()
  `);
  if (!state.svg || state.pathCount < 8) {
    throw new Error(`Ridgeline SVG not populated: ${JSON.stringify(state)}`);
  }
  return { detail: `ridgeline visible with ${state.pathCount} paths and ${state.textCount} labels`, screenshotPath };
}

async function testExport({ screenshotPath }: TestContext): Promise<TestMeta> {
  await openOpsDetails2D();
  await installDownloadSpy();
  const ref = await findRef((r) => r.role === "button" && r.label.includes("导出") && r.label.toUpperCase().includes("PNG"));
  await click(ref);
  await wait(1500);
  const downloads = await readDownloads();
  const latest = downloads[downloads.length - 1];
  if (!latest) {
    throw new Error("No download-like anchor click was observed");
  }
  const marker = latest.download || latest.href;
  if (!/\.png\b/i.test(marker)) {
    throw new Error(`Expected PNG export marker, got ${marker}`);
  }
  return { detail: `captured export marker ${marker}`, screenshotPath };
}

async function testRecords({ screenshotPath }: TestContext): Promise<TestMeta> {
  await openDashboardHome();
  const ref = await findRef((r) => r.role === "button" && r.label.includes("记录"));
  await click(ref);
  await waitForCondition(
    "records page",
    `(() => {
      const page = document.querySelector("#page-records.active");
      const body = document.getElementById("transactions-tbody");
      return !!page && !!body;
    })()`,
  );
  const state = await evalJson<{ rows: number; pageTitle: string }>(`
    (() => ({
      rows: document.querySelectorAll("#transactions-tbody tr").length,
      pageTitle: String((document.querySelector("#page-records .page-title") || {}).textContent || "").trim()
    }))()
  `);
  if (state.rows < 1) {
    throw new Error("Transactions table rendered no rows");
  }
  return { detail: `records page loaded with ${state.rows} transaction row(s)`, screenshotPath };
}

async function testDragRangeCompare(_ctx: TestContext): Promise<TestMeta> {
  await openOpsDetails2D();
  const box = await getOpsChartBox();
  const startX = Math.round(box.x + box.width * 0.18);
  const endX = Math.round(box.x + box.width * 0.62);
  const midY = Math.round(box.y + box.height * 0.55);
  const dragShotPath = shot("testDragRangeCompare-mid");
  let mouseIsDown = false;

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
      throw new Error(`Range selection markers missing during drag: ${JSON.stringify(midState)}`);
    }

    await screenshot(dragShotPath);
  } finally {
    if (mouseIsDown) {
      try {
        await mouse("up", "left");
      } catch {
        // Preserve the original error if mouse release fails.
      }
    }
  }

  await wait(300);
  const finalState = await readRangeCompareState();
  if (finalState.summaryVisible) {
    throw new Error("Range compare summary did not disappear after mouseup");
  }

  return {
    detail: "range compare summary appeared during drag and cleared after release",
    screenshotPath: dragShotPath,
  };
}

async function testTaskClick({ screenshotPath }: TestContext): Promise<TestMeta> {
  await openOpsDetailTable("tasks");
  const result = await clickFirstRow("tr[data-task-id]", "#task-detail-card");
  if (!result.clicked) {
    throw new Error("No task row found");
  }
  if (result.beforeCount !== 0 || result.afterCount <= result.beforeCount || !result.visible) {
    throw new Error(`Task detail card did not appear correctly: ${JSON.stringify(result)}`);
  }
  return { detail: `task detail card opened with text "${result.cardText}"`, screenshotPath };
}

async function testAccountClick({ screenshotPath }: TestContext): Promise<TestMeta> {
  await openOpsDetailTable("accounts");
  const result = await clickFirstRow("tr[data-account-id]", "#account-hover-card");
  if (!result.clicked) {
    throw new Error("No account row found");
  }
  if (result.beforeCount !== 0 || result.afterCount <= result.beforeCount || !result.visible) {
    throw new Error(`Account popout did not appear correctly: ${JSON.stringify(result)}`);
  }
  return { detail: `account popout opened with text "${result.cardText}"`, screenshotPath };
}

async function testResponsive800({ screenshotPath }: TestContext): Promise<TestMeta> {
  await openDashboardHome(800, 900);
  const state = await evalJson<{ noHorizontalScroll: boolean; cards: number; toolbarVisible: boolean; navVisible: boolean }>(`
    (() => {
      const toolbar = document.querySelector("#page-dashboard .toolbar");
      const nav = document.querySelector(".sidebar");
      return {
        noHorizontalScroll: document.documentElement.scrollWidth <= window.innerWidth + 1,
        cards: document.querySelectorAll("#highlightGrid .highlight-card").length,
        toolbarVisible: !!toolbar && getComputedStyle(toolbar).display !== "none",
        navVisible: !!nav && getComputedStyle(nav).display !== "none"
      };
    })()
  `);
  if (!state.noHorizontalScroll) {
    throw new Error("Horizontal scroll detected at 800px viewport");
  }
  if (state.cards < 1 || !state.toolbarVisible || !state.navVisible) {
    throw new Error(`Key elements missing at 800px viewport: ${JSON.stringify(state)}`);
  }
  return { detail: `responsive check passed with ${state.cards} cards and no horizontal overflow`, screenshotPath };
}

async function main(): Promise<void> {
  const tests: Array<[string, (ctx: TestContext) => Promise<string | TestMeta | void>]> = [
    ["testLoad", testLoad],
    ["testRangeSwitch", testRangeSwitch],
    ["testHover", testHover],
    ["testOpsSection", testOpsSection],
    ["testRidgeline", testRidgeline],
    ["testExport", testExport],
    ["testRecords", testRecords],
    ["testDragRangeCompare", testDragRangeCompare],
    ["testTaskClick", testTaskClick],
    ["testAccountClick", testAccountClick],
    ["testResponsive800", testResponsive800],
  ];

  const results: TestResult[] = [];
  for (const [name, test] of tests) {
    results.push(await runTest(name, test));
  }

  const passed = results.filter((result) => result.result === "✅").length;
  const failed = results.length - passed;

  finalizeReport(reportPath);
  console.log(`[ui-smoke] summary: pass=${passed} fail=${failed} report=${rel(reportPath)}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  appendRow(reportPath, "fatal", "❌", formatError(error));
  finalizeReport(reportPath);
  console.error("[ui-smoke][fatal]", formatError(error));
  process.exitCode = 1;
});
