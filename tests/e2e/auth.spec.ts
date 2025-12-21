import { test, expect } from '@playwright/test'

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear storage before each test
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('should redirect to config page when no credentials', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/.*\/config/)
  })

  test('should show config form', async ({ page }) => {
    await page.goto('/config')
    
    await expect(page.getByRole('heading', { name: /Configure Telegram API/i })).toBeVisible()
    await expect(page.getByLabel(/API ID/i)).toBeVisible()
    await expect(page.getByLabel(/API Hash/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /Continue/i })).toBeVisible()
  })

  test('should validate config inputs', async ({ page }) => {
    await page.goto('/config')
    
    // Try to submit empty form
    await page.getByRole('button', { name: /Continue/i }).click()
    
    // Should not navigate (form has required fields)
    await expect(page).toHaveURL(/.*\/config/)
  })

  test('should save config and navigate to auth', async ({ page }) => {
    await page.goto('/config')
    
    await page.getByLabel(/API ID/i).fill('12345678')
    await page.getByLabel(/API Hash/i).fill('abcdef1234567890abcdef1234567890')
    await page.getByRole('button', { name: /Continue/i }).click()
    
    await expect(page).toHaveURL(/.*\/auth/)
  })

  test('should show phone input on auth page', async ({ page }) => {
    // Set config first
    await page.goto('/config')
    await page.getByLabel(/API ID/i).fill('12345678')
    await page.getByLabel(/API Hash/i).fill('abcdef1234567890abcdef1234567890')
    await page.getByRole('button', { name: /Continue/i }).click()
    
    await expect(page).toHaveURL(/.*\/auth/)
    await expect(page.getByRole('heading', { name: /Sign in to Telegram/i })).toBeVisible()
    await expect(page.getByLabel(/Phone Number/i)).toBeVisible()
  })

  test('should show privacy notice', async ({ page }) => {
    await page.goto('/config')
    await page.getByLabel(/API ID/i).fill('12345678')
    await page.getByLabel(/API Hash/i).fill('abcdef1234567890abcdef1234567890')
    await page.getByRole('button', { name: /Continue/i }).click()
    
    // Privacy notice should appear
    await expect(page.getByRole('heading', { name: /Your Privacy Matters/i })).toBeVisible()
    await expect(page.getByText(/100% on-device/i)).toBeVisible()
  })

  test('should dismiss privacy notice', async ({ page }) => {
    await page.goto('/config')
    await page.getByLabel(/API ID/i).fill('12345678')
    await page.getByLabel(/API Hash/i).fill('abcdef1234567890abcdef1234567890')
    await page.getByRole('button', { name: /Continue/i }).click()
    
    await page.getByRole('button', { name: /I Understand/i }).click()
    
    // Modal should close
    await expect(page.getByRole('heading', { name: /Your Privacy Matters/i })).not.toBeVisible()
    
    // Should persist
    const stored = await page.evaluate(() => localStorage.getItem('privacy_notice_seen'))
    expect(stored).toBe('true')
  })
})

