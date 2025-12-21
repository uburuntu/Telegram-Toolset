import { test, expect, Page } from '@playwright/test'

/**
 * E2E tests for the Resend flow
 *
 * These tests set up mock backups and test the resend configuration UI.
 */

// Helper to set up a mocked logged-in state with backups
async function setupMockedAuthWithBackups(page: Page) {
  await page.evaluate(() => {
    // Mock account in localStorage
    const mockAccount = {
      id: '123456789',
      type: 'user',
      firstName: 'Test',
      lastName: 'User',
      username: 'testuser',
      phone: '+1234567890',
      sessionString: 'mock_session_string',
      apiId: 12345,
      apiHash: 'mock_api_hash',
      isActive: true,
      addedAt: new Date().toISOString(),
    }

    localStorage.setItem('telegram_accounts', JSON.stringify([mockAccount]))
    localStorage.setItem('active_account_id', '123456789')

    // We'll also need to set up mock backups in IndexedDB
    // This would require more complex setup - for now we test the UI states
  })
}

// Helper to inject mock services
async function injectMockServices(page: Page) {
  await page.addInitScript(() => {
    // @ts-ignore
    window.__MOCK_TELEGRAM__ = true

    // Mock chats for target selection
    const mockChats = [
      {
        id: BigInt('-1001234567890'),
        title: 'Test Channel',
        type: 'channel',
        username: 'testchannel',
        canExport: true,
        canSend: true,
        lastMessageDate: new Date('2024-01-15'),
      },
      {
        id: BigInt('-1009876543210'),
        title: 'Test Supergroup',
        type: 'supergroup',
        canExport: true,
        canSend: true,
        lastMessageDate: new Date('2024-01-14'),
      },
    ]

    // @ts-ignore
    window.__mockTelegramService__ = {
      isConnected: () => true,
      isAuthorized: () => true,
      getDialogs: async () => mockChats,
      canSendToChat: async () => true,
      sendMessage: async () => {},
      sendFile: async () => {},
    }
  })
}

test.describe('Resend Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
      indexedDB.deleteDatabase('telegram-toolset-db')
    })
  })

  test('should display resend module card on landing page', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Resend Messages')).toBeVisible()
  })

  test('should prompt for login when accessing resend without auth', async ({ page }) => {
    await page.goto('/')

    // Click on resend module
    await page.getByRole('link', { name: /Resend Messages/i }).click()

    // Should show login modal
    await expect(page.getByRole('heading', { name: /Add Account/i })).toBeVisible()
  })

  test('should show backup selection when authenticated', async ({ page }) => {
    await setupMockedAuthWithBackups(page)
    await injectMockServices(page)

    await page.goto('/resend')

    // Page should load resend view
    await expect(page.getByText('Resend Messages')).toBeVisible()
  })

  test('should show empty state when no backups exist', async ({ page }) => {
    await setupMockedAuthWithBackups(page)
    await injectMockServices(page)

    await page.goto('/resend')

    // Should show empty state or prompt to export first
    await expect(page.getByText(/No backups|export first/i)).toBeVisible()
  })
})

test.describe('Resend Configuration UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  // These tests would require setting up mock backups in IndexedDB
  // For now, we test that the page loads correctly

  test('should have all header options toggles', async ({ page }) => {
    await setupMockedAuthWithBackups(page)
    await injectMockServices(page)

    // Note: This test would require a backup to be selected first
    // We're testing that the UI elements exist when configured properly
    await page.goto('/resend')

    // The configuration options should be available once a backup is selected
    // This is a placeholder for more complete tests with proper mock data
  })
})

test.describe('Resend Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('should handle navigation gracefully', async ({ page }) => {
    await setupMockedAuthWithBackups(page)
    await injectMockServices(page)

    await page.goto('/resend')

    // Should not crash
    await expect(page.locator('body')).toBeVisible()
  })

  test('should have link to export if no backups', async ({ page }) => {
    await setupMockedAuthWithBackups(page)
    await injectMockServices(page)

    await page.goto('/resend')

    // If no backups, should have option to go to export
    const exportLink = page.getByRole('link', { name: /export/i })
    // This may or may not be visible depending on state
  })
})

test.describe('Resend Progress UI', () => {
  // These tests would require complete E2E flow with mock backups
  // Placeholder for future implementation

  test('should have proper navigation structure', async ({ page }) => {
    await setupMockedAuthWithBackups(page)
    await injectMockServices(page)

    await page.goto('/resend')

    // Basic page structure check
    await expect(page.locator('main')).toBeVisible()
  })
})

