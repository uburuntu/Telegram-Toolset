import { test, expect } from '@playwright/test'

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('should show app title', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Telegram Power Toolset' })).toBeVisible()
  })

  test('should show module cards', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Account Info')).toBeVisible()
    await expect(page.getByText('Export Deleted Messages')).toBeVisible()
  })

  test('should show privacy features section', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('100% Private')).toBeVisible()
    await expect(page.getByText('Local Storage')).toBeVisible()
    // Avoid strict-mode ambiguity: "Open Source" appears in both the heading and description text.
    await expect(page.getByRole('heading', { name: 'Open Source' })).toBeVisible()
  })

  test('should open login modal when clicking module without account', async ({ page }) => {
    await page.goto('/')

    // Click on a module card (buttons, not links)
    await page.getByText('Account Info').click()

    // Login modal should appear
    await expect(page.getByText('Add Account')).toBeVisible()
  })

  test('should close login modal with X button', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Account Info').click()

    // Find and click close button
    await page.getByRole('button', { name: '✕' }).click()

    // Modal should close
    await expect(page.getByText('Add Account')).not.toBeVisible()
  })
})
