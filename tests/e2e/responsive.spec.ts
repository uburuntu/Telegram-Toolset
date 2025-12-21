import { test, expect } from '@playwright/test'

test.describe('Responsive Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
    })
  })

  test.describe('Desktop viewport', () => {
    test.use({ viewport: { width: 1280, height: 720 } })

    test('should show full header on desktop', async ({ page }) => {
      await page.goto('/')

      // Header should be visible
      await expect(page.getByText('Telegram Toolset')).toBeVisible()
    })

    test('should show module cards in grid', async ({ page }) => {
      await page.goto('/')

      // Should have multiple module cards visible
      await expect(page.getByText('Account Info')).toBeVisible()
      await expect(page.getByText('Export Deleted Messages')).toBeVisible()
    })
  })

  test.describe('Mobile viewport', () => {
    test.use({ viewport: { width: 375, height: 667 } })

    test('should show landing page on mobile', async ({ page }) => {
      await page.goto('/')

      await expect(page.getByText('Telegram Power Toolset')).toBeVisible()
    })

    test('should have proper layout on mobile', async ({ page }) => {
      await page.goto('/')

      // Main content should fit within viewport
      const main = page.locator('main')
      const box = await main.boundingBox()

      expect(box!.width).toBeLessThanOrEqual(375)
    })

    test('should open login modal on mobile', async ({ page }) => {
      await page.goto('/')

      await page.getByText('Account Info').click()

      await expect(page.getByText('Add Account')).toBeVisible()
    })
  })

  test.describe('Tablet viewport', () => {
    test.use({ viewport: { width: 768, height: 1024 } })

    test('should handle tablet size gracefully', async ({ page }) => {
      await page.goto('/')

      await expect(page.getByText('Telegram Power Toolset')).toBeVisible()
      await expect(page.getByText('Account Info')).toBeVisible()
    })
  })
})
