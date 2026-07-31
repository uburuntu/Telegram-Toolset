import { expect, type Page, test } from '@playwright/test'

async function storeAccount(page: Page, type: 'user' | 'bot'): Promise<void> {
  await page.evaluate((accountType) => {
    const account = {
      id: `${accountType}-account`,
      type: accountType,
      label: accountType === 'user' ? 'Alice Example' : 'Tool Bot',
      firstName: accountType === 'user' ? 'Alice' : 'Tool Bot',
      username: accountType === 'user' ? 'alice' : 'tool_bot',
      phone: accountType === 'user' ? '+441234567890' : undefined,
      botToken: accountType === 'bot' ? '42:test_token' : undefined,
      sessionString: accountType === 'user' ? 'mock_session_string' : '',
      createdAt: '2025-01-10T12:00:00.000Z',
      lastUsedAt: '2026-07-30T18:00:00.000Z',
    }

    localStorage.setItem('telegram_accounts', JSON.stringify([account]))
    localStorage.setItem('telegram_active_account', account.id)
    localStorage.setItem(
      'telegram_api_credentials',
      JSON.stringify({ apiId: 12345, apiHash: 'mock_api_hash' }),
    )
  }, type)
}

async function injectAccountMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // @ts-ignore - E2E-only service injection consumed by src/services/telegram/client.ts.
    window.__MOCK_TELEGRAM__ = true
    // @ts-ignore - the app intentionally replaces its Telegram singleton with this facade in E2E.
    window.__mockTelegramService__ = {
      isConnected: true,
      user: { id: BigInt(7), firstName: 'Alice', username: 'alice' },
      connectionState: 'connected',
      onFloodWait: () => () => {},
      getFullMe: async () => ({
        id: BigInt(7),
        firstName: 'Alice',
        lastName: 'Example',
        username: 'alice',
        phone: '441234567890',
        bio: 'Account bio',
        isPremium: true,
        isVerified: true,
        isRestricted: false,
        commonChatsCount: 12,
        activeUsernames: ['alice_work'],
        languageCode: 'en',
        birthday: { day: 14, month: 2, year: 1990 },
        hasProfilePhoto: true,
        hasProfileVideo: true,
        dcId: 4,
      }),
      getAccountStats: async () => ({
        dialogsCount: 1234,
        contactsCount: 56,
        blockedCount: 2,
      }),
      getAccountSecurityInfo: async () => ({
        twoStepVerificationEnabled: true,
        recoveryEmailConfigured: true,
        authorizedSessionsCount: 3,
        otherSessionsCount: 2,
        unconfirmedSessionsCount: 1,
        authorizationTtlDays: 180,
        accountTtlDays: 548,
        currentSession: {
          appName: 'Telegram Toolset',
          appVersion: '1.0',
          deviceModel: 'Chrome',
          platform: 'macOS',
          systemVersion: '15',
          location: 'United Kingdom, London',
          createdAt: new Date('2026-01-01T12:00:00.000Z'),
          lastActiveAt: new Date('2026-01-02T12:00:00.000Z'),
          officialApp: false,
        },
      }),
      downloadMyProfilePhoto: async () =>
        new Blob(
          [
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2563eb"/></svg>',
          ],
          { type: 'image/svg+xml' },
        ),
      beginActiveAccountTransition: () => 0,
      completeActiveAccountTransition: () => {},
      useUserAccountSession: async () => true,
      disconnect: async () => {},
    }
  })
}

test.describe('Account Info', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
  })

  test('shows the extended user profile and security summary', async ({ page }) => {
    await storeAccount(page, 'user')
    await injectAccountMock(page)
    await page.goto('/account-info')

    await expect(page.getByRole('heading', { name: 'Account Info' })).toBeVisible()
    await expect(page.getByText('@alice_work')).toBeVisible()
    await expect(page.getByText('February 14, 1990')).toBeVisible()
    await expect(page.getByText('English (EN)')).toBeVisible()
    await expect(page.getByText('1,234')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Security & sessions' })).toBeVisible()
    await expect(page.getByText('3 total, 2 other')).toBeVisible()
    await expect(page.getByText('After 6 months')).toBeVisible()
    await expect(page.getByText('After 18 months')).toBeVisible()
    await expect(page.getByText('Chrome, macOS 15')).toBeVisible()
    await expect(page.getByText('United Kingdom, London')).toBeVisible()

    const accountMenuTrigger = page.getByTestId('account-menu-trigger')
    await expect(accountMenuTrigger.locator('img')).toBeVisible()
    await accountMenuTrigger.click()
    await expect(page.getByTestId('account-avatar-image')).toHaveCount(2)
  })

  test('fits the user detail view on a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await storeAccount(page, 'user')
    await injectAccountMock(page)
    await page.goto('/account-info')

    await expect(page.getByRole('heading', { name: 'Security & sessions' })).toBeVisible()
    const dimensions = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
  })

  test('shows current Bot API capabilities', async ({ page }) => {
    await storeAccount(page, 'bot')
    await injectAccountMock(page)
    await page.route('https://api.telegram.org/bot*/getMe', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          result: {
            id: 42,
            is_bot: true,
            first_name: 'Tool Bot',
            username: 'tool_bot',
            is_premium: true,
            can_join_groups: true,
            can_read_all_group_messages: false,
            supports_inline_queries: true,
            added_to_attachment_menu: true,
            can_connect_to_business: true,
            has_main_web_app: true,
          },
        }),
      })
    })
    await page.goto('/account-info')

    await expect(page.getByRole('heading', { name: 'Bot Capabilities' })).toBeVisible()
    await expect(page.getByText('Attachment menu')).toBeVisible()
    await expect(page.getByText('Business connections')).toBeVisible()
    await expect(page.getByText('Privacy mode')).toBeVisible()
    await expect(page.getByText('Premium')).toBeVisible()
  })
})
