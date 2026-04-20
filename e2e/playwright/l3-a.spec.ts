import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import {
  checkServices,
  openDashboardHome,
  openOpsTab,
  readHighlightValues,
  readSnapshotHighlightValues,
  waitForDashboardRangeSnapshot,
  waitForHighlightValuesToChange,
  waitForHighlightValuesToMatch,
} from './helpers'

let availability = {
  ready: false,
  reason: 'frontend/backend health check has not run yet',
}

test.beforeAll(async () => {
  availability = await checkServices(['frontend', 'backend'])
})

test('switching range to today and back to last 7 days updates KPI values', async ({ page }) => {
  test.skip(!availability.ready, availability.reason)

  await openDashboardHome(page)

  const initialSevenDayValues = await readHighlightValues(page)
  await page.locator('#page-dashboard .toolbar-btn').filter({ hasText: '今日' }).click()
  await waitForDashboardRangeSnapshot(page, 'today')
  const todayValues = await waitForHighlightValuesToChange(page, initialSevenDayValues)

  await page.locator('#page-dashboard .toolbar-btn').filter({ hasText: '近一周' }).click()
  await waitForDashboardRangeSnapshot(page, '7d')
  const expectedRestoredSevenDayValues = await readSnapshotHighlightValues(page)
  const restoredSevenDayValues = await waitForHighlightValuesToMatch(page, expectedRestoredSevenDayValues)

  expect(todayValues).not.toEqual(initialSevenDayValues)
  expect(restoredSevenDayValues).toEqual(expectedRestoredSevenDayValues)
  expect(restoredSevenDayValues).not.toEqual(todayValues)
  await expect(page.locator('#page-dashboard .toolbar-btn.active')).toContainText('近一周')
})

test('ops CSV export triggers a browser download', async ({ page }, testInfo) => {
  test.skip(!availability.ready, availability.reason)

  await openOpsTab(page)

  const downloadPromise = page.waitForEvent('download')
  await page.locator('#dashTab-ops .report-export-actions .btn-export-sm').filter({ hasText: '导出 CSV' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/\.csv$/)

  const downloadPath = testInfo.outputPath('l3-a-ops-export.csv')
  await download.saveAs(downloadPath)

  const csv = (await readFile(downloadPath, 'utf8')).replace(/^\uFEFF/, '')
  expect(csv).toContain('日期')
})

test('drag compare shows the range summary during drag and clears on mouseup', async ({ page }) => {
  test.skip(!availability.ready, availability.reason)

  await openOpsTab(page)
  await page.locator('.chart-view-btn').filter({ hasText: '2D' }).click()

  const chart = page.locator('#opsTaskChart')
  const box = await chart.boundingBox()
  expect(box).not.toBeNull()

  if (!box) {
    throw new Error('opsTaskChart is not visible')
  }

  const startX = box.x + box.width * 0.18
  const endX = box.x + box.width * 0.62
  const midY = box.y + box.height * 0.55

  await page.mouse.move(startX, midY)
  await page.mouse.down()
  await page.mouse.move(endX, midY)

  const summary = page.locator('.range-compare-summary')
  await expect(summary).toHaveClass(/visible/)

  await page.mouse.up()
  await expect(summary).not.toHaveClass(/visible/)
})
