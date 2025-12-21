import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Vite dev-server dependency optimization is not stable under heavy parallel navigation:
  // we observed `504 (Outdated Optimize Dep)` which cascades into lazy-route import failures.
  // Keep E2E deterministic by default.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // One worker avoids multiple browser contexts racing Vite optimizeDeps.
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile viewports
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  webServer: {
    // Force fresh optimizeDeps on each E2E run to prevent "Outdated Optimize Dep" 504s.
    command: 'npm run dev -- --force --port 5173',
    url: 'http://localhost:5173',
    // Always start our own server so config changes take effect and optimizeDeps is fresh.
    reuseExistingServer: false,
  },
})

