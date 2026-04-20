import { expect, test } from '@playwright/test'

import {
  checkServices,
  horizontalReachability,
  openDashboardHome,
  openEnterprisePage,
  openRecordsPage,
  saveArtifact,
} from './helpers'

let availability = {
  ready: false,
  reason: 'frontend/backend health check has not run yet',
}

test.beforeAll(async () => {
  availability = await checkServices(['frontend', 'backend'])
})

test('narrow viewports keep the shell reachable and 1440px stays stable', async ({ page }, testInfo) => {
  test.skip(!availability.ready, availability.reason)

  await openDashboardHome(page)

  for (const width of [390, 430, 800]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(250)

    const layout = await horizontalReachability(page)
    expect(layout.rightEdgeReachable).toBe(true)
    expect(layout.overflowX).not.toBe('hidden')
    expect(layout.totalWidth).toBeGreaterThanOrEqual(Number.parseInt(layout.minWidth, 10) || width)
  }

  await page.setViewportSize({ width: 390, height: 900 })
  await page.waitForTimeout(250)
  await saveArtifact(page, testInfo, 'l3-c-responsive-390.png')

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForTimeout(250)

  const desktop = await horizontalReachability(page)
  expect(desktop.totalWidth).toBeLessThanOrEqual(desktop.innerWidth + 1)

  await saveArtifact(page, testInfo, 'l3-c-responsive-1440.png')
})

test('enterprise member search filters the list', async ({ page }) => {
  test.skip(!availability.ready, availability.reason)

  await openEnterprisePage(page)

  const rows = page.locator('#membersBody tr')
  const initialCount = await rows.count()
  expect(initialCount).toBeGreaterThan(0)

  const firstMemberName = (await page.locator('#membersBody .td-bold').first().textContent())?.trim() ?? ''
  const query = firstMemberName.slice(0, 2) || firstMemberName
  expect(query.length).toBeGreaterThan(0)

  const searchInput = page.locator('#entMemberSearch')
  await searchInput.fill(query)

  await expect
    .poll(async () => {
      const names = await page.locator('#membersBody .td-bold').allTextContents()
      return names.length > 0 && names.every((name) => name.includes(query))
    })
    .toBe(true)

  await searchInput.fill('playwright-no-match')
  await expect(page.locator('#membersBody')).toContainText('未找到匹配的成员')
})

test('transactions pagination moves forward and back', async ({ page }) => {
  test.skip(!availability.ready, availability.reason)

  await openRecordsPage(page)

  const info = page.locator('#recordTab-transactions .pagi-info')
  const nextButton = page.locator('#recordTab-transactions .pagination-btn[data-direction="1"]')
  const prevButton = page.locator('#recordTab-transactions .pagination-btn[data-direction="-1"]')

  await expect(nextButton).toBeEnabled()

  const firstPageInfo = (await info.textContent())?.trim() ?? ''
  const firstRowText = (await page.locator('#transactions-tbody tr').first().textContent())?.trim() ?? ''

  await nextButton.click()
  await expect(info).toContainText('第 2 页')

  const secondPageInfo = (await info.textContent())?.trim() ?? ''
  const secondRowText = (await page.locator('#transactions-tbody tr').first().textContent())?.trim() ?? ''

  expect(secondPageInfo).not.toBe(firstPageInfo)
  expect(secondRowText).not.toBe(firstRowText)

  await prevButton.click()
  await expect(info).toContainText('第 1 页')
})
