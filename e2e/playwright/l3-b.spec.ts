import { expect, test, type Page } from '@playwright/test'

import {
  checkServices,
  openDashboardHome,
  openOpsTab,
} from './helpers'

let availability = {
  ready: false,
  reason: 'frontend/backend health check has not run yet',
}

test.beforeAll(async () => {
  availability = await checkServices(['frontend', 'backend'])
})

async function hoverDonutUntilInteractive(
  page: Page,
  canvasSelector: string,
  centerSelector: string,
): Promise<{ canvasChanged: boolean; centerHidden: boolean; tooltipVisible: boolean }> {
  const canvas = page.locator(canvasSelector)
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()

  if (!box) {
    throw new Error(`missing canvas ${canvasSelector}`)
  }

  const baseline = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL())
  const probePoints: Array<[number, number]> = [
    [0.84, 0.24],
    [0.72, 0.14],
    [0.88, 0.52],
    [0.52, 0.1],
    [0.16, 0.5],
    [0.34, 0.84],
  ]

  for (const [xRatio, yRatio] of probePoints) {
    await page.mouse.move(box.x + box.width * xRatio, box.y + box.height * yRatio)
    await page.waitForTimeout(150)

    const state = await page.evaluate(
      ({ baselineImage, canvasSelector: nextCanvasSelector, centerSelector: nextCenterSelector }) => {
        const canvas = document.querySelector(nextCanvasSelector) as HTMLCanvasElement | null
        const center = document.querySelector(nextCenterSelector) as HTMLElement | null
        const chartCtor = (window as any).Chart
        const chart = chartCtor?.getChart?.(canvas)

        return {
          canvasChanged: Boolean(canvas && canvas.toDataURL() !== baselineImage),
          centerHidden: Boolean(center && getComputedStyle(center).opacity === '0'),
          tooltipVisible: Boolean(chart?.tooltip && chart.tooltip.opacity > 0),
        }
      },
      {
        baselineImage: baseline,
        canvasSelector,
        centerSelector,
      },
    )

    if (state.centerHidden && (state.tooltipVisible || state.canvasChanged)) {
      return state
    }
  }

  throw new Error(`failed to activate donut hover state for ${canvasSelector}`)
}

test('donut hover activates segment highlight and tooltip state', async ({ page }) => {
  test.skip(!availability.ready, availability.reason)

  await openDashboardHome(page)

  const platformDonutState = await hoverDonutUntilInteractive(page, '#donutChart', '#donutSection .donut-center')
  const interactionDonutState = await hoverDonutUntilInteractive(page, '#interactionDonut', '#interactionSection .donut-center')

  expect(platformDonutState.centerHidden).toBe(true)
  expect(platformDonutState.tooltipVisible || platformDonutState.canvasChanged).toBe(true)
  expect(interactionDonutState.centerHidden).toBe(true)
  expect(interactionDonutState.tooltipVisible || interactionDonutState.canvasChanged).toBe(true)
})

test('ridgeline chart renders multiple series and hover affordance', async ({ page }) => {
  test.skip(!availability.ready, availability.reason)

  await openOpsTab(page)
  await page.locator('.chart-view-btn').filter({ hasText: '脊线图' }).click()

  const ridgeline = page.locator('#opsRidgelineContainer')
  await expect(ridgeline).toBeVisible()
  await expect(ridgeline.locator('svg')).toBeVisible()
  await expect
    .poll(async () => ridgeline.locator('svg path').count())
    .toBeGreaterThan(5)

  const hoverTarget = ridgeline.locator('.ridge-overlay')
  const box = await hoverTarget.boundingBox()
  expect(box).not.toBeNull()

  if (!box) {
    throw new Error('ridgeline hover overlay is not visible')
  }

  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.35)
  await expect(ridgeline.locator('.ridge-tooltip')).toBeVisible()
})

test('ops detail rows expand into the task detail card', async ({ page }) => {
  test.skip(!availability.ready, availability.reason)

  await openOpsTab(page)

  const firstTaskRow = page.locator('#scenarioCardsFull tr[data-task-id]').first()
  await expect(firstTaskRow).toBeVisible()
  await firstTaskRow.click()

  const detailCard = page.locator('#task-detail-card.visible')
  await expect(detailCard).toBeVisible()
  await expect(detailCard.locator('.task-detail-name')).toContainText(/\S/)
  await expect
    .poll(async () => detailCard.locator('.task-detail-metrics .metric').count())
    .toBeGreaterThan(0)
})
