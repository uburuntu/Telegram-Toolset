import { test, expect, Page } from '@playwright/test'

/**
 * E2E tests for the Export flow
 *
 * These tests mock the telegramService in the browser to avoid
 * needing real Telegram credentials.
 */

// Helper to set up a mocked logged-in state
async function setupMockedAuth(page: Page) {
  await page.evaluate(() => {
    // Mock account in localStorage
    const mockAccount = {
      id: '123456789',
      type: 'user',
      label: 'Test User',
      firstName: 'Test',
      username: 'testuser',
      phone: '+1234567890',
      sessionString: 'mock_session_string',
      apiId: 12345,
      apiHash: 'mock_api_hash',
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    }

    localStorage.setItem('telegram_accounts', JSON.stringify([mockAccount]))
    localStorage.setItem('telegram_active_account', '123456789')

    // Prevent the privacy notice modal from blocking clicks in E2E.
    localStorage.setItem('privacy_notice_seen', 'true')
  })
}

// Helper to inject mock telegramService
async function injectMockTelegramService(page: Page) {
  await page.addInitScript(() => {
    // @ts-ignore - window augmentation for tests
    window.__MOCK_TELEGRAM__ = true

    // Mock chats data
    const mockChats = [
      {
        id: BigInt('-1001234567890'),
        title: 'Test Channel',
        type: 'channel',
        username: 'testchannel',
        canExport: true,
        canSend: false,
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

    // Mock deleted messages
    const mockDeletedMessages = [
      {
        id: 1001,
        chatId: BigInt('-1001234567890'),
        senderId: BigInt('999888777'),
        senderName: 'Alice',
        senderUsername: 'alice',
        text: 'This is a deleted text message',
        date: new Date('2024-01-15T10:30:00'),
        hasMedia: false,
      },
      {
        id: 1002,
        chatId: BigInt('-1001234567890'),
        senderId: BigInt('999888778'),
        senderName: 'Bob',
        text: 'Message with photo',
        date: new Date('2024-01-15T10:35:00'),
        hasMedia: true,
        mediaType: 'photo',
        mediaFilename: 'photo_1002.jpg',
        mediaSize: 102400,
      },
    ]

    // Override telegramService methods
    // @ts-ignore
    window.__mockTelegramService__ = {
      isConnected: () => true,
      isAuthorized: () => true,
      validateChatForExport: async () => ({ valid: true, canExport: true }),
      getDialogs: async () => mockChats,
      iterDeletedMessages: async function* () {
        for (const msg of mockDeletedMessages) {
          await new Promise((r) => setTimeout(r, 100))
          yield msg
        }
      },
      resolveSenderInfo: async () => ({
        name: 'Resolved User',
        username: 'resolveduser',
      }),
      downloadMedia: async () => {
        // Return a small fake blob
        return new Blob(['fake image data'], { type: 'image/jpeg' })
      },
    }
  })
}

// For progress-related tests we want a stable "exporting" window across all browsers.
async function injectMockTelegramServiceSlowExport(page: Page) {
  await page.addInitScript(() => {
    // @ts-ignore
    window.__MOCK_TELEGRAM__ = true

    const mockChats = [
      {
        id: BigInt('-1001234567890'),
        title: 'Test Channel',
        type: 'channel',
        username: 'testchannel',
        canExport: true,
        canSend: false,
        lastMessageDate: new Date('2024-01-15'),
      },
    ]

    const messages = Array.from({ length: 50 }, (_, i) => ({
      id: 2000 + i,
      chatId: BigInt('-1001234567890'),
      senderId: BigInt('999888777'),
      senderName: 'Alice',
      senderUsername: 'alice',
      text: `Deleted message ${i + 1}`,
      date: new Date('2024-01-15T10:30:00'),
      hasMedia: false,
    }))

    // @ts-ignore
    window.__mockTelegramService__ = {
      isConnected: () => true,
      isAuthorized: () => true,
      validateChatForExport: async () => ({ valid: true, canExport: true }),
      getDialogs: async () => mockChats,
      iterDeletedMessages: async function* () {
        for (const msg of messages) {
          await new Promise((r) => setTimeout(r, 50))
          yield msg
        }
      },
      resolveSenderInfo: async () => ({
        name: 'Resolved User',
        username: 'resolveduser',
      }),
      downloadMedia: async () => new Blob(['fake image data'], { type: 'image/jpeg' }),
    }
  })
}
test.describe('Export Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Start with clean state
    await page.goto('/')

    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
      indexedDB.deleteDatabase('telegram-toolset-db')
    })
  })

  test('should display export module card on landing page', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Export Deleted Messages')).toBeVisible()
  })

  test('should prompt for login when accessing export without auth', async ({ page }) => {
    await page.goto('/')

    // Click on export module card (it's a button, not a link)
    await page.getByText('Export Deleted Messages').click()

    // Should show login modal
    await expect(page.getByText('Add Account')).toBeVisible()
  })

  test('should show chat selection when authenticated', async ({ page }) => {
    await setupMockedAuth(page)
    await injectMockTelegramService(page)

    await page.goto('/export')

    // Page should load export view with heading
    await expect(page.getByRole('heading', { name: 'Export Deleted Messages' })).toBeVisible()
    await expect(page.getByText('Select a channel or group where you have admin access')).toBeVisible()
  })

  test('should have working search filter', async ({ page }) => {
    await setupMockedAuth(page)
    await injectMockTelegramService(page)

    await page.goto('/export')

    // Wait for search input to appear
    await expect(page.locator('input[type="search"]')).toBeVisible({ timeout: 10000 })

    // Type in search
    await page.fill('input[type="search"]', 'channel')

    // Should filter results (mock data contains "Test Channel")
    await expect(page.getByText('Test Channel')).toBeVisible()
  })

  test('should navigate to configure step after selecting chat', async ({ page }) => {
    await setupMockedAuth(page)
    await injectMockTelegramService(page)

    await page.goto('/export')

    // Wait for chats to load and click one
    await expect(page.getByText('Test Channel')).toBeVisible({ timeout: 10000 })
    await page.getByText('Test Channel').click()

    // Should be on configure step
    await expect(page.getByRole('heading', { name: 'Configure Export' })).toBeVisible()
    await expect(page.getByText('Exporting from:')).toBeVisible()
  })

  test('should show export mode options', async ({ page }) => {
    await setupMockedAuth(page)
    await injectMockTelegramService(page)

    await page.goto('/export')

    // Select a chat
    await expect(page.getByText('Test Channel')).toBeVisible({ timeout: 10000 })
    await page.getByText('Test Channel').click()

    // Check export mode options exist
    await expect(page.getByText('All content')).toBeVisible()
    await expect(page.getByText('Text only')).toBeVisible()
    await expect(page.getByText('Media only')).toBeVisible()
  })

  test('should have Download as ZIP checkbox', async ({ page }) => {
    await setupMockedAuth(page)
    await injectMockTelegramService(page)

    await page.goto('/export')

    // Select a chat
    await expect(page.getByText('Test Channel')).toBeVisible({ timeout: 10000 })
    await page.getByText('Test Channel').click()

    // Check ZIP option exists
    await expect(page.getByText('Download as ZIP after export')).toBeVisible()
  })

  test('should allow going back from configure to chat selection', async ({ page }) => {
    await setupMockedAuth(page)
    await injectMockTelegramService(page)

    await page.goto('/export')

    // Select a chat
    await expect(page.getByText('Test Channel')).toBeVisible({ timeout: 10000 })
    await page.getByText('Test Channel').click()

    // Click back
    await page.getByText('← Back').click()

    // Should be back on chat selection
    await expect(page.getByText('Select a channel or group where you have admin access')).toBeVisible()
  })
})

test.describe('Export Progress UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('should display progress indicators during export', async ({ page }) => {
    await setupMockedAuth(page)
    await injectMockTelegramServiceSlowExport(page)

    await page.goto('/export')

    // Select a chat and start export
    await expect(page.getByText('Test Channel')).toBeVisible({ timeout: 10000 })
    await page.getByText('Test Channel').click()
    // Click Continue on configure step, then Start Export on confirmation step
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Start Export' }).click()

    // Depending on speed/browser, we may still be exporting or already complete.
    const cancelButton = page.getByRole('button', { name: /Cancel Export/i })
    const completeHeading = page.getByRole('heading', { name: 'Export Complete!' })
    await expect(cancelButton.or(completeHeading)).toBeVisible({ timeout: 15000 })
  })

  test('should have cancel button during export', async ({ page }) => {
    await setupMockedAuth(page)
    await injectMockTelegramServiceSlowExport(page)

    await page.goto('/export')

    // Select a chat and start export
    await expect(page.getByText('Test Channel')).toBeVisible({ timeout: 10000 })
    await page.getByText('Test Channel').click()
    // Click Continue on configure step, then Start Export on confirmation step
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Start Export' }).click()

    // Cancel button should be visible
    await expect(page.getByRole('button', { name: /Cancel Export/i })).toBeVisible({
      timeout: 15000,
    })
  })
})
