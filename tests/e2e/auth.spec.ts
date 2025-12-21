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
    await expect(page.getByText('Telegram Power Toolset')).toBeVisible()
  })

  test('should show module cards', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Account Info')).toBeVisible()
    await expect(page.getByText('Export Deleted Messages')).toBeVisible()
  })

  test('should show privacy footer', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('100% on-device. No data leaves your browser.')).toBeVisible()
  })

  test('should open login modal when clicking module without account', async ({ page }) => {
    await page.goto('/')

    // Click on a module card
    await page.getByText('Account Info').click()

    // Login modal should appear
    await expect(page.getByText('Add Account')).toBeVisible()
  })

  test('should show user and bot tabs in login modal', async ({ page }) => {
    await page.goto('/')
    await page.getByText('Account Info').click()

    await expect(page.getByRole('button', { name: '👤 User Account' })).toBeVisible()
    await expect(page.getByRole('button', { name: '🤖 Bot Token' })).toBeVisible()
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
