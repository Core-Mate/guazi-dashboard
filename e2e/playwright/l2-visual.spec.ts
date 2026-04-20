import { expect, test } from '@playwright/test'

import {
  checkServices,
  openDashboardHome,
  openEnterprisePage,
  saveArtifact,
} from './helpers'

let availability = {
  ready: false,
  reason: 'frontend/backend health check has not run yet',
}

test.beforeAll(async () => {
  availability = await checkServices(['frontend', 'backend'])
})

test('dashboard home renders the primary KPI shell', async ({ page }, testInfo) => {
  test.skip(!availability.ready, availability.reason)

  await openDashboardHome(page)

  await expect(page.locator('#page-dashboard.active')).toBeVisible()
  await expect
    .poll(async () => page.locator('#highlightGrid .highlight-card').count())
    .toBeGreaterThan(2)
  await expect(page.locator('#donutSection')).toBeVisible()
  await expect(page.locator('#interactionSection')).toBeVisible()

  await saveArtifact(page, testInfo, 'l2-dashboard-home.png')
})

test('enterprise members table renders live rows', async ({ page }, testInfo) => {
  test.skip(!availability.ready, availability.reason)

  await openEnterprisePage(page)

  await expect(page.locator('#entMemberSearch')).toBeVisible()
  await expect
    .poll(async () => page.locator('#membersBody tr').count())
    .toBeGreaterThan(0)
  await expect(page.locator('#membersBody tr').first()).toContainText(/\S/)

  await saveArtifact(page, testInfo, 'l2-enterprise-members.png')
})

test('highlight hover shows the floating popout', async ({ page }, testInfo) => {
  test.skip(!availability.ready, availability.reason)

  await openDashboardHome(page)

  const firstCard = page.locator('#highlightGrid .highlight-card').first()
  await firstCard.hover()

  const popout = page.locator('.highlight-popout-floating.visible')
  await expect(popout).toBeVisible()

  await saveArtifact(page, testInfo, 'l2-highlight-popout.png')
})
