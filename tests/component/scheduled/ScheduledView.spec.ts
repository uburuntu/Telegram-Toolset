import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import ScheduledView from '@/modules/scheduled/ScheduledView.vue'
import { scheduledService } from '@/services/scheduled/scheduled-service'
import { telegramService } from '@/services/telegram/client'
import { useAccountsStore } from '@/stores'
import type { ChatInfo, SavedAccount } from '@/types'

vi.mock('@/services/scheduled/scheduled-service', () => ({
  scheduledService: {
    isLoading: false,
    cancel: vi.fn(),
    getScheduledMessagesForChat: vi.fn(),
    getAllScheduledMessages: vi.fn(),
    deleteScheduledMessagesByPeer: vi.fn(),
    exportToJson: vi.fn(),
    formatScheduledDate: vi.fn(() => ''),
  },
}))

vi.mock('@/services/telegram/client', () => ({
  telegramService: { getDialogs: vi.fn() },
}))

const scheduledServiceMock = scheduledService as unknown as {
  isLoading: boolean
  cancel: ReturnType<typeof vi.fn>
}

function createUserAccount(overrides: Partial<SavedAccount> = {}): SavedAccount {
  return {
    id: 'acct-1',
    type: 'user',
    label: 'Alice',
    firstName: 'Alice',
    phone: '+1234567890',
    sessionString: 'session',
    createdAt: new Date('2024-03-10T12:00:00Z'),
    lastUsedAt: new Date('2024-03-10T12:00:00Z'),
    ...overrides,
  }
}

function createChat(overrides: Partial<ChatInfo> = {}): ChatInfo {
  return {
    id: BigInt(1),
    title: 'Chat',
    type: 'channel',
    canExport: true,
    canSend: true,
    isAdmin: true,
    ...overrides,
  }
}

function mountView(pinia: ReturnType<typeof createPinia>) {
  return mount(ScheduledView, {
    global: {
      plugins: [pinia, i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
}

describe('ScheduledView account-switch guards', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(telegramService.getDialogs).mockReset()
    scheduledServiceMock.isLoading = false

    pinia = createPinia()
    setActivePinia(pinia)
    const accounts = useAccountsStore()
    accounts.accounts = [createUserAccount(), createUserAccount({ id: 'acct-2', phone: '+1987654321' })]
    accounts.activeAccountId = 'acct-1'
  })

  it('cancels in-flight scheduled work when the active account changes', async () => {
    vi.mocked(telegramService.getDialogs).mockResolvedValue([])

    mountView(pinia)
    await flushPromises()

    // Ignore the unconditional cancel the immediate watcher fires on mount.
    scheduledServiceMock.cancel.mockClear()

    useAccountsStore().activeAccountId = 'acct-2'
    await flushPromises()

    expect(scheduledServiceMock.cancel).toHaveBeenCalledTimes(1)
  })

  it('discards a stale chat load that resolves after the account changed', async () => {
    let resolveFirst!: (chats: ChatInfo[]) => void
    let resolveSecond!: (chats: ChatInfo[]) => void
    const firstLoad = new Promise<ChatInfo[]>((resolve) => {
      resolveFirst = resolve
    })
    const secondLoad = new Promise<ChatInfo[]>((resolve) => {
      resolveSecond = resolve
    })
    vi.mocked(telegramService.getDialogs)
      .mockReturnValueOnce(firstLoad)
      .mockReturnValueOnce(secondLoad)

    const wrapper = mountView(pinia)
    await flushPromises()

    useAccountsStore().activeAccountId = 'acct-2'
    await flushPromises()

    resolveSecond([createChat({ id: BigInt(2), title: 'Account B Chat' })])
    await flushPromises()
    resolveFirst([createChat({ id: BigInt(1), title: 'Account A Chat' })])
    await flushPromises()

    // The single-chat mode reveals the loaded chat list.
    const singleModeButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes(i18n.global.t('scheduled.singleChat')))
    expect(singleModeButton).toBeDefined()
    await singleModeButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Account B Chat')
    expect(wrapper.text()).not.toContain('Account A Chat')
  })
})
