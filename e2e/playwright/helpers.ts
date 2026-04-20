import { expect, type Page, type TestInfo } from '@playwright/test'

export const FRONTEND_BASE_URL = process.env.PLAYWRIGHT_FRONTEND_BASE_URL ?? 'http://localhost:8402'
export const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:8403'
export const E2E_LOGIN_PHONE = process.env.E2E_LOGIN_PHONE ?? '13800138001'
export const E2E_LOGIN_CODE = process.env.E2E_LOGIN_CODE ?? '123456'
const DASHBOARD_RANGE_TIMEOUT_MS = 15_000

interface AuthUser {
  id: number
  name: string
  phoneNumber: string
  role: string
  tenant_id: number
  tenant_name: string
}

interface AuthSession {
  token: string
  user: AuthUser
}

type ServiceName = 'frontend' | 'backend'

export interface ServiceAvailability {
  ready: boolean
  reason: string
}

let authSessionPromise: Promise<AuthSession> | null = null

function withTimeout(timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5_000): Promise<Response> {
  const timeout = withTimeout(timeoutMs)
  try {
    return await fetch(url, { ...init, signal: timeout.signal })
  } finally {
    timeout.clear()
  }
}

async function checkFrontend(): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(FRONTEND_BASE_URL, { redirect: 'manual' })
    if (response.ok || (response.status >= 300 && response.status < 400)) {
      return null
    }
    return `frontend ${FRONTEND_BASE_URL} returned ${response.status}`
  } catch (error) {
    return `frontend ${FRONTEND_BASE_URL} unreachable: ${String(error)}`
  }
}

async function checkBackend(): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/health`)
    if (!response.ok) {
      return `backend ${API_BASE_URL}/health returned ${response.status}`
    }
    const body = await response.json()
    if (!body || body.ok !== true) {
      return `backend ${API_BASE_URL}/health returned unexpected JSON`
    }
    return null
  } catch (error) {
    return `backend ${API_BASE_URL}/health unreachable: ${String(error)}`
  }
}

export async function checkServices(required: ServiceName[]): Promise<ServiceAvailability> {
  const failures: string[] = []

  if (required.includes('frontend')) {
    const frontendFailure = await checkFrontend()
    if (frontendFailure) failures.push(frontendFailure)
  }

  if (required.includes('backend')) {
    const backendFailure = await checkBackend()
    if (backendFailure) failures.push(backendFailure)
  }

  if (failures.length > 0) {
    return {
      ready: false,
      reason: failures.join('; '),
    }
  }

  return {
    ready: true,
    reason: 'required services are ready',
  }
}

export async function authHeaders(): Promise<Record<string, string>> {
  const session = await getAuthSession()
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${session.token}`,
  }
}

export async function getAuthSession(): Promise<AuthSession> {
  if (authSessionPromise) {
    return authSessionPromise
  }

  authSessionPromise = (async () => {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        phone: E2E_LOGIN_PHONE,
        code: E2E_LOGIN_CODE,
      }),
    })

    const body = await response.json().catch(() => null)
    if (!response.ok || !body?.token || !body?.user) {
      throw new Error(`mock login failed: ${response.status} ${JSON.stringify(body)}`)
    }

    return {
      token: String(body.token),
      user: body.user as AuthUser,
    }
  })()

  return authSessionPromise
}

async function seedDashboardAuth(page: Page): Promise<void> {
  const session = await getAuthSession()
  await page.addInitScript(
    ({ token, user }) => {
      try {
        localStorage.setItem('authToken', token)
        localStorage.setItem('currentUser', JSON.stringify(user))
        localStorage.removeItem('dashboardApiKey')
        localStorage.removeItem('dashboardTenantId')
        localStorage.removeItem('tenant_id')
        localStorage.removeItem('tenantId')
      } catch {}
    },
    { token: session.token, user: session.user },
  )
}

export async function openDashboardHome(page: Page): Promise<void> {
  await seedDashboardAuth(page)
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const loader = document.getElementById('globalLoader')
    const cards = document.querySelectorAll('#highlightGrid .highlight-card').length
    return Boolean(
      loader?.classList.contains('hidden')
      && document.querySelector('#page-dashboard.active')
      && cards > 0
      && (window as any).__lastSnap,
    )
  })
  await expect(page.locator('#page-dashboard.active')).toBeVisible()
  await expect
    .poll(async () => page.locator('#highlightGrid .highlight-card').count())
    .toBeGreaterThan(0)
}

export async function openEnterprisePage(page: Page): Promise<void> {
  await openDashboardHome(page)
  await page.locator('#nav-enterprise').click()
  await expect(page.locator('#page-enterprise.active')).toBeVisible()
  await expect(page.locator('#entMemberSearch')).toBeVisible()
  await expect
    .poll(async () => page.locator('#membersBody tr').count())
    .toBeGreaterThan(0)
}

export async function openRecordsPage(page: Page): Promise<void> {
  await openDashboardHome(page)
  await page.locator('#nav-records').click()
  await expect(page.locator('#page-records.active')).toBeVisible()
  await expect(page.locator('#recordTab-transactions.active')).toBeVisible()
  await expect
    .poll(async () => page.locator('#transactions-tbody tr').count())
    .toBeGreaterThan(0)
}

export async function openOpsTab(page: Page): Promise<void> {
  await openDashboardHome(page)
  await page.locator('#page-dashboard .tab-btn').filter({ hasText: '运维详情' }).click()
  await expect(page.locator('#dashTab-ops.active')).toBeVisible()
  await expect(page.locator('#opsTaskChart')).toBeVisible()
  await expect
    .poll(async () => page.locator('#scenarioCardsFull tr[data-task-id]').count())
    .toBeGreaterThan(0)
}

export async function readHighlightValues(page: Page): Promise<string[]> {
  const values = await page.locator('#highlightGrid .highlight-card .highlight-value').allTextContents()
  return values.map((value) => value.replace(/\s+/g, ' ').trim())
}

export async function readSnapshotHighlightValues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const snapshot = (window as any).__lastSnap
    const cards = Array.isArray(snapshot?.highlights?.cards) ? snapshot.highlights.cards : []
    return cards.map((card: { value?: unknown; unit?: string }) => {
      const value = typeof card?.value === 'number' ? card.value : Number(card?.value || 0)
      const unit = card?.unit || ''
      if (value >= 10_000) return Math.round(value).toLocaleString()
      if (value % 1 !== 0) return value.toFixed(1) + unit
      return String(Math.round(value)) + unit
    })
  })
}

export async function waitForDashboardRangeSnapshot(page: Page, range: string): Promise<void> {
  await page.waitForFunction(
    (expectedRange) => {
      const loader = document.getElementById('globalLoader')
      const snapshot = (window as any).__lastSnap
      return Boolean(
        loader?.classList.contains('hidden')
        && snapshot
        && snapshot.range === expectedRange,
      )
    },
    range,
    { timeout: DASHBOARD_RANGE_TIMEOUT_MS },
  )
}

export async function waitForHighlightValuesToChange(page: Page, previous: string[]): Promise<string[]> {
  const previousSnapshot = JSON.stringify(previous)
  await expect
    .poll(async () => JSON.stringify(await readHighlightValues(page)))
    .not.toBe(previousSnapshot)
  return readHighlightValues(page)
}

export async function waitForHighlightValuesToMatch(page: Page, expectedValues: string[]): Promise<string[]> {
  const nextSnapshot = JSON.stringify(expectedValues)
  await expect
    .poll(async () => JSON.stringify(await readHighlightValues(page)))
    .toBe(nextSnapshot)
  return readHighlightValues(page)
}

export async function saveArtifact(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(name),
  })
}

export async function horizontalReachability(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const body = document.body
    const totalWidth = Math.max(
      root.scrollWidth,
      root.clientWidth,
      body.scrollWidth,
      body.clientWidth,
    )

    window.scrollTo({ left: 0, top: 0 })
    const maxLeft = Math.max(0, totalWidth - window.innerWidth)
    window.scrollTo({ left: maxLeft, top: 0 })

    return {
      innerWidth: window.innerWidth,
      maxScrollX: window.scrollX,
      minWidth: getComputedStyle(body).minWidth,
      overflowX: getComputedStyle(body).overflowX,
      totalWidth,
      rightEdgeReachable: Math.ceil(window.scrollX + window.innerWidth) >= totalWidth,
    }
  })
}
