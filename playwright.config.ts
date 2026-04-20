import { defineConfig, devices } from '@playwright/test'

const frontendBaseURL = process.env.PLAYWRIGHT_FRONTEND_BASE_URL ?? 'http://localhost:8402'
const apiBaseURL = process.env.PLAYWRIGHT_API_BASE_URL ?? 'http://localhost:8403'

export default defineConfig({
  testDir: './e2e/playwright',
  timeout: 30_000,
  globalTimeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  outputDir: 'test-results/playwright',
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: frontendBaseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  metadata: {
    apiBaseURL,
    frontendBaseURL,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
      },
    },
  ],
})
