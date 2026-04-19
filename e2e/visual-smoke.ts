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
import { askCodexVisualRetry } from "./lib/codex-visual";
import { appendRow, finalizeReport, initReport } from "./lib/report";

const DEFAULT_VIEWPORT = { width: 1440, height: 960 };
const RUN_ID = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
const BASE_URL = DEFAULT_BASE_URL.endsWith("/") ? DEFAULT_BASE_URL : `${DEFAULT_BASE_URL}/`;
const reportPath = initReport(RUN_ID, "visual-smoke");
const artifactDir = join(dirname(reportPath), "visual-smoke-artifacts");

mkdirSync(artifactDir, { recursive: true });

type ResultMark = "✅" | "⚠️" | "❌";

interface VisualResult {
  name: string;
  result: ResultMark;
  detail: string;
  screenshot: string;
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
      // Continue polling through transient page state.
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

async function openDashboardHome(): Promise<void> {
  await resetViewport();
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

async function clickDom(script: string, failureMessage: string): Promise<void> {
  const clicked = await evalJson<boolean>(script);
  if (!clicked) {
    throw new Error(failureMessage);
  }
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
      return !!tab && tab.classList.contains("active") && !!chart && !!rect && rect.width > 200 && rect.height > 100;
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

async function runVisual(
  name: string,
  produceScreenshot: () => Promise<string>,
  prompt: string,
): Promise<VisualResult> {
  try {
    const image = await produceScreenshot();
    if (!existsSync(image)) {
      throw new Error(`Screenshot missing after capture: ${image}`);
    }

    const verdict = await askCodexVisualRetry(
      {
        image,
        prompt,
        schema: '{"pass": boolean, "reason": string}',
      },
      1,
    );

    const result: ResultMark = verdict.pass ? "✅" : "⚠️";
    const detail = `pass=${verdict.pass} reason=${verdict.reason}`;
    appendRow(reportPath, name, result, `${detail}; screenshot=\`${rel(image)}\``);
    console.log(`[visual-smoke] ${result} ${name} -> ${detail}`);
    return { name, result, detail, screenshot: image };
  } catch (error) {
    const detail = formatError(error);
    const failureShot = shot(`${name}-FAIL`);
    try {
      await screenshot(failureShot);
    } catch {
      // Ignore secondary screenshot failures.
    }
    appendRow(reportPath, name, "❌", `${detail}; screenshot=\`${rel(failureShot)}\``);
    console.log(`[visual-smoke] ❌ ${name} -> ${detail}`);
    return { name, result: "❌", detail, screenshot: failureShot };
  }
}

async function testHighlightPopoutVisual(): Promise<string> {
  const image = shot("testHighlightPopoutVisual");
  await openDashboardHome();
  const ref = await findRef((r) => r.label.includes("完成"));
  await hover(ref);
  await waitForCondition(
    "highlight popout",
    `(() => !!document.querySelector(".highlight-popout-floating.visible"))()`,
  );
  await screenshot(image);
  return image;
}

async function testRidgelineVisual(): Promise<string> {
  const image = shot("testRidgelineVisual");
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
  await screenshot(image);
  return image;
}

async function testDragCompareVisual(): Promise<string> {
  const image = shot("testDragCompareVisual");
  await openOpsDetails2D();
  const box = await getOpsChartBox();
  const startX = Math.round(box.x + box.width * 0.18);
  const endX = Math.round(box.x + box.width * 0.62);
  const midY = Math.round(box.y + box.height * 0.55);
  let mouseIsDown = false;

  try {
    await mouse("move", startX, midY);
    await mouse("down", "left");
    mouseIsDown = true;
    await mouse("move", endX, midY);
    await waitForCondition(
      "range compare overlay",
      `(() => !!document.querySelector(".range-compare-summary.visible"))()`,
      4000,
      200,
    );
    await screenshot(image);
    return image;
  } finally {
    if (mouseIsDown) {
      try {
        await mouse("up", "left");
      } catch {
        // Ignore release errors here so the main failure is preserved.
      }
    }
  }
}

async function main(): Promise<void> {
  const results = [];
  results.push(
    await runVisual(
      "testHighlightPopoutVisual",
      testHighlightPopoutVisual,
      'Does this screenshot show a dashboard metric card with its hover popout or floating detail bubble visibly expanded near the metric, while the metric number and label remain readable? Return {"pass": boolean, "reason": string}',
    ),
  );
  results.push(
    await runVisual(
      "testRidgelineVisual",
      testRidgelineVisual,
      'Does this screenshot show a ridgeline chart with multiple vertically stacked filled curves sharing the same horizontal timeline, rather than a single line or bar chart? Return {"pass": boolean, "reason": string}',
    ),
  );
  results.push(
    await runVisual(
      "testDragCompareVisual",
      testDragCompareVisual,
      'Does this screenshot show a chart during an active drag selection, with one continuous highlighted range or band, clear start and end boundary markers, and a summary tooltip or bubble at or near the cursor showing values for the selected period? Do not expect two separate highlighted periods or two comparison bands. Return {"pass": boolean, "reason": string}',
    ),
  );

  const pass = results.filter((result) => result.result === "✅").length;
  const warn = results.filter((result) => result.result === "⚠️").length;
  const fail = results.filter((result) => result.result === "❌").length;

  finalizeReport(reportPath);
  console.log(`[visual-smoke] summary: pass=${pass} warn=${warn} fail=${fail} report=${rel(reportPath)}`);
}

main().catch((error) => {
  appendRow(reportPath, "fatal", "❌", formatError(error));
  finalizeReport(reportPath);
  console.error("[visual-smoke][fatal]", formatError(error));
  process.exitCode = 1;
});
