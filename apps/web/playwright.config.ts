import { defineConfig, devices } from '@playwright/test'

const port = 4173

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 3,
  expect: {
    timeout: 5_000
  },
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: `npm run dev --workspace @vostok/web -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    }
  ]
})
