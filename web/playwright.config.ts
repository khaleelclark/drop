import { defineConfig } from '@playwright/test'
const port = process.env.HOUSEHOLD_TEST_PORT || '18173'
const baseURL = `http://127.0.0.1:${port}`
const downloadPort = process.env.HOUSEHOLD_DOWNLOAD_TEST_PORT || '18174'
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 30_000,
  use: {
    baseURL, browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'node ./e2e/download-server.cjs', env: {HOUSEHOLD_DOWNLOAD_TEST_PORT:downloadPort}, url: `http://127.0.0.1:${downloadPort}/health`, reuseExistingServer: false },
    { command: `pnpm dev --port ${port} --strictPort`, env: {HOUSEHOLD_API_PROXY:`http://127.0.0.1:${downloadPort}`}, url: baseURL, reuseExistingServer: false },
  ],
})
