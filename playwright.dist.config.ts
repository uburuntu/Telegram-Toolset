import { defineConfig, devices } from '@playwright/test'
import { bypassLocalProxy } from './playwright.proxy'

bypassLocalProxy()

// Chromium smoke run against the real production build served by `vite preview`,
// catching prod-only failures (lazy-chunk splitting, minification, base path)
// that the dev server hides. Requires `npm run build` first (CI reuses the build
// artifact); run locally with `npm run test:e2e:dist`.
const PORT = 4173

export default defineConfig({
  testDir: './tests/e2e-dist',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  outputDir: 'test-results-dist',
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: 'playwright-report-dist', open: 'never' }]]
    : [['html', { outputFolder: 'playwright-report-dist' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
