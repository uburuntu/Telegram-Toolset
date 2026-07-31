import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import type { SavedAccount } from '@/types'

const mocks = vi.hoisted(() => ({
  getFullMe: vi.fn(),
  getAccountStats: vi.fn(),
  getAccountSecurityInfo: vi.fn(),
  downloadMyProfilePhoto: vi.fn(),
  getBotInfo: vi.fn(),
}))

vi.mock('@/services/telegram/gateway', () => ({
  telegramAccountGateway: {
    getFullMe: mocks.getFullMe,
    getAccountStats: mocks.getAccountStats,
    getAccountSecurityInfo: mocks.getAccountSecurityInfo,
    downloadMyProfilePhoto: mocks.downloadMyProfilePhoto,
  },
}))

vi.mock('@/services/telegram/bot-api', () => ({
  getBotInfo: mocks.getBotInfo,
}))

import AccountInfoView from '@/modules/account-info/AccountInfoView.vue'
import { useAccountsStore } from '@/stores'

function userAccount(): SavedAccount {
  return {
    id: 'user-1',
    type: 'user',
    label: 'Alice Example',
    firstName: 'Alice',
    username: 'alice',
    phone: '+441234567890',
    sessionString: 'session',
    createdAt: new Date('2025-01-10T12:00:00Z'),
    lastUsedAt: new Date('2026-07-30T18:00:00Z'),
  }
}

function botAccount(): SavedAccount {
  return {
    id: 'bot-1',
    type: 'bot',
    label: 'Tool Bot',
    username: 'tool_bot',
    botToken: '42:secret',
    sessionString: '',
    createdAt: new Date('2025-01-10T12:00:00Z'),
    lastUsedAt: new Date('2026-07-30T18:00:00Z'),
  }
}

function mountView() {
  return mount(AccountInfoView, {
    global: {
      plugins: [i18n],
    },
  })
}

describe('AccountInfoView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setActivePinia(createPinia())
    i18n.global.locale.value = 'en'

    mocks.getFullMe.mockResolvedValue({
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
      hasProfilePhoto: false,
      hasProfileVideo: false,
      dcId: 4,
    })
    mocks.getAccountStats.mockResolvedValue({
      dialogsCount: 1234,
      contactsCount: 56,
      blockedCount: 2,
    })
    mocks.getAccountSecurityInfo.mockResolvedValue({
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
        createdAt: new Date('2026-01-01T12:00:00Z'),
        lastActiveAt: new Date('2026-01-02T12:00:00Z'),
        officialApp: false,
      },
    })
    mocks.downloadMyProfilePhoto.mockResolvedValue(null)
  })

  it('shows extended user profile, security, and session facts', async () => {
    const accounts = useAccountsStore()
    accounts.accounts = [userAccount()]
    accounts.activeAccountId = 'user-1'

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Other active usernames')
    expect(wrapper.text()).toContain('@alice_work')
    expect(wrapper.text()).toContain('February 14, 1990')
    expect(wrapper.text()).toContain('English (EN)')
    expect(wrapper.text()).toContain('1,234')
    expect(wrapper.get('[data-testid="account-security"]').text()).toContain(
      'Security & sessions',
    )
    expect(wrapper.text()).toContain('3 total, 2 other')
    expect(wrapper.text()).toContain('After 6 months')
    expect(wrapper.text()).toContain('After 18 months')
    expect(wrapper.text()).toContain('Telegram Toolset 1.0')
    expect(wrapper.text()).toContain('Chrome, macOS 15')
    expect(wrapper.text()).toContain('United Kingdom, London')
    expect(wrapper.text()).toContain('Third-party app')
    expect(mocks.downloadMyProfilePhoto).not.toHaveBeenCalled()
  })

  it('shows the current Bot API capability set without MTProto calls', async () => {
    const accounts = useAccountsStore()
    accounts.accounts = [botAccount()]
    accounts.activeAccountId = 'bot-1'
    mocks.getBotInfo.mockResolvedValue({
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
    })

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Bot Capabilities')
    expect(wrapper.text()).toContain('Attachment menu')
    expect(wrapper.text()).toContain('Business connections')
    expect(wrapper.text()).toContain('Web App')
    expect(wrapper.text()).toContain('Privacy mode')
    expect(wrapper.text()).toContain('Premium')
    expect(mocks.getBotInfo).toHaveBeenCalledWith('42:secret')
    expect(mocks.getFullMe).not.toHaveBeenCalled()
    expect(mocks.getAccountSecurityInfo).not.toHaveBeenCalled()
  })
})
