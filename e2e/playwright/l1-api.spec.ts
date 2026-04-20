import { expect, test } from '@playwright/test'

import { API_BASE_URL, TENANT_ID, authHeaders, checkServices } from './helpers'

const SNAPSHOT_KEYS = [
  'highlights',
  'charts',
  'aggs',
  'ops_trend',
  'members',
  'wallet',
  'transactions',
  'audit_log',
]

let availability = {
  ready: false,
  reason: 'backend health check has not run yet',
}

test.beforeAll(async () => {
  availability = await checkServices(['backend'])
})

test('GET /health returns 200 and pool JSON', async ({ request }) => {
  test.skip(!availability.ready, availability.reason)

  const response = await request.get(`${API_BASE_URL}/health`)
  expect(response.status()).toBe(200)

  const body = await response.json()
  expect(body).toEqual(
    expect.objectContaining({
      ok: true,
      pool: expect.objectContaining({
        size: expect.any(Number),
        idle_size: expect.any(Number),
        free: expect.any(Number),
      }),
    }),
  )
})

test('GET /api/dashboard/snapshot returns the dashboard payload shape', async ({ request }) => {
  test.skip(!availability.ready, availability.reason)

  const response = await request.get(`${API_BASE_URL}/api/dashboard/snapshot?range=7d&tenant_id=${TENANT_ID}`, {
    headers: authHeaders(),
  })

  expect(response.status()).toBe(200)

  const body = await response.json()
  for (const key of SNAPSHOT_KEYS) {
    expect(body).toHaveProperty(key)
  }
})

test('GET /api/members returns an array for the dev tenant', async ({ request }) => {
  test.skip(!availability.ready, availability.reason)

  const response = await request.get(`${API_BASE_URL}/api/members?tenant_id=${TENANT_ID}`, {
    headers: authHeaders(),
  })

  expect(response.status()).toBe(200)

  const body = await response.json()
  expect(Array.isArray(body)).toBe(true)
  if (body.length > 0) {
    expect(body[0]).toEqual(expect.objectContaining({ id: expect.any(Number) }))
    expect(typeof body[0].name === 'string' || typeof body[0].username === 'string').toBe(true)
  }
})

test('GET /api/members without X-API-Key returns 401', async ({ request }) => {
  test.skip(!availability.ready, availability.reason)

  const response = await request.get(`${API_BASE_URL}/api/members`)
  expect(response.status()).toBe(401)

  const body = await response.json()
  expect(String(body.detail ?? body.error ?? '')).toContain('X-API-Key')
})
