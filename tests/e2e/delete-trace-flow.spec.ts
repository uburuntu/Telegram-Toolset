import { expect, type Page, test } from '@playwright/test'

async function setupMockedAccount(page: Page): Promise<void> {
  await page.evaluate(() => {
    const account = {
      id: 'account-a',
      type: 'user',
      label: 'Test User',
      firstName: 'Test',
      username: 'testuser',
      phone: '+1234567890',
      principal: { kind: 'user', telegramUserId: '100' },
      sessionString: 'mock_session_string',
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    }

    localStorage.setItem('telegram_accounts', JSON.stringify([account]))
    localStorage.setItem('telegram_active_account', account.id)
    localStorage.setItem(
      'telegram_api_credentials',
      JSON.stringify({ apiId: 12345, apiHash: 'mock_api_hash' }),
    )
  })
}

async function injectTelegramTraceMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-ignore - E2E-only service injection consumed by src/services/telegram/client.ts.
    window.__MOCK_TELEGRAM__ = true
    // @ts-ignore - asserted at the end of the browser workflow.
    window.__traceDeleteCalls = []

    const chats = [
      {
        id: BigInt(10),
        title: 'Public Archive Chat',
        type: 'supergroup',
        username: 'archive_chat',
        canExport: false,
        canSend: true,
        isAdmin: false,
        lastMessageDate: new Date('2021-05-01T00:00:00.000Z'),
      },
      {
        id: BigInt(20),
        title: 'Project Group',
        type: 'group',
        canExport: false,
        canSend: true,
        isAdmin: false,
        lastMessageDate: new Date('2025-01-01T00:00:00.000Z'),
      },
    ]

    // @ts-ignore - the app intentionally replaces its Telegram singleton with this facade in E2E.
    window.__mockTelegramService__ = {
      isConnected: true,
      user: { id: BigInt(100), firstName: 'Test', username: 'testuser' },
      connectionState: 'connected',
      onFloodWait: () => () => {},
      getDialogs: async () => chats,
      searchOwnMessages: async (chatId: bigint) => {
        if (chatId === BigInt(10)) {
          return {
            messages: [
              { id: 30, date: new Date('2021-01-10T00:00:00.000Z') },
              { id: 20, date: new Date('2020-06-10T00:00:00.000Z') },
              { id: 10, date: new Date('2020-01-10T00:00:00.000Z') },
            ],
            total: 3,
          }
        }
        return { messages: [], total: 0 }
      },
      deleteMessages: async (chatId: bigint, messageIds: number[]) => {
        // @ts-ignore - E2E assertion hook.
        window.__traceDeleteCalls.push({ chatId: chatId.toString(), messageIds })
      },
      getExistingMessageIds: async () => [],
      beginActiveAccountTransition: () => 0,
      completeActiveAccountTransition: () => {},
      useUserAccountSession: async () => true,
      disconnect: async () => {},
    }
  })
}

test.describe('Delete My Messages flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('shows the module and requires a user account', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Delete My Messages')).toBeVisible()
    await page.getByText('Delete My Messages').click()
    await expect(page.getByText('Add Account')).toBeVisible()
  })

  test('scans, confirms, and deletes only the selected chat messages', async ({ page }) => {
    await setupMockedAccount(page)
    await injectTelegramTraceMock(page)
    await page.goto('/delete-trace')

    await expect(page.getByRole('heading', { name: 'Delete My Messages' })).toBeVisible()
    await expect(page.getByText('Public Archive Chat')).toBeVisible({ timeout: 10000 })
    await page.getByText('Public Archive Chat').click()
    await page.getByRole('button', { name: 'Next' }).click()

    await page.getByLabel('From date').fill('2020-01-01')
    await page.getByLabel('Through date').fill('2021-12-31')
    await page.getByRole('button', { name: 'Scan my messages' }).click()

    await expect(page.getByRole('heading', { name: 'Review deletion' })).toBeVisible()
    await expect(page.getByText('Found 3 messages across 1 chats.')).toBeVisible()
    await page
      .getByLabel('I understand that 3 messages will be permanently deleted.')
      .check()
    await page.getByRole('button', { name: 'Delete 3 messages' }).click()

    await expect(page.getByRole('heading', { name: 'Deletion results' })).toBeVisible()
    await expect(page.getByText('Confirmed 3 of 3 requested deletions.')).toBeVisible()
    await expect(page.getByText('Deleted', { exact: true })).toBeVisible()

    const calls = await page.evaluate(() => {
      // @ts-ignore - E2E assertion hook installed above.
      return window.__traceDeleteCalls
    })
    expect(calls).toEqual([{ chatId: '10', messageIds: [30, 20, 10] }])
  })
})
