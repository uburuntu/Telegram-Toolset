import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import ExportView from '@/modules/export-deleted/ExportView.vue'
import { exportService } from '@/services/export/export-service'
import { telegramService } from '@/services/telegram/client'
import { useAccountsStore } from '@/stores'
import type { ChatInfo, SavedAccount } from '@/types'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/services/export/export-service', () => ({
  exportService: {
    isExporting: false,
    cancel: vi.fn(),
    exportDeletedMessages: vi.fn(),
  },
}))

vi.mock('@/services/telegram/client', () => ({
  telegramService: {
    getDialogs: vi.fn(),
    canManualReconnect: vi.fn(() => false),
    manualReconnect: vi.fn(),
  },
}))

vi.mock('@/services/storage/backup-manager', () => ({
  backupManager: { createBackup: vi.fn() },
}))

vi.mock('@/services/storage/quota', () => ({
  quotaManager: { ensurePersisted: vi.fn(), getStorageEstimate: vi.fn() },
}))

vi.mock('@/services/export/zip-generator', () => ({
  zipGenerator: { generateAndDownload: vi.fn() },
}))

// The service is mocked; expose a mutable handle so tests can simulate an in-flight export.
const exportServiceMock = exportService as unknown as {
  isExporting: boolean
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
  return mount(ExportView, {
    global: {
      plugins: [pinia, i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
}

describe('ExportView account-switch guards', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(telegramService.getDialogs).mockReset()
    exportServiceMock.isExporting = false

    pinia = createPinia()
    setActivePinia(pinia)
    const accounts = useAccountsStore()
    accounts.accounts = [createUserAccount(), createUserAccount({ id: 'acct-2', phone: '+1987654321' })]
    accounts.activeAccountId = 'acct-1'
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

    // The newer account's load resolves first, then the stale one.
    resolveSecond([createChat({ id: BigInt(2), title: 'Account B Chat' })])
    await flushPromises()
    resolveFirst([createChat({ id: BigInt(1), title: 'Account A Chat' })])
    await flushPromises()

    expect(wrapper.text()).toContain('Account B Chat')
    expect(wrapper.text()).not.toContain('Account A Chat')
  })

  it('cancels an in-flight export when the active account changes', async () => {
    vi.mocked(telegramService.getDialogs).mockResolvedValue([])

    const wrapper = mountView(pinia)
    await flushPromises()

    exportServiceMock.isExporting = true
    useAccountsStore().activeAccountId = 'acct-2'
    await flushPromises()

    expect(exportServiceMock.cancel).toHaveBeenCalled()
    expect(wrapper.text()).toContain(i18n.global.t('export.selectChat'))
  })
})
