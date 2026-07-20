import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import ResendView from '@/modules/resend/ResendView.vue'
import { resendService } from '@/services/resend/resend-service'
import { backupManager } from '@/services/storage/backup-manager'
import { telegramService } from '@/services/telegram/client'
import { useAccountsStore } from '@/stores'
import type { Backup, SavedAccount } from '@/types'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/services/resend/resend-service', () => ({
  resendService: {
    isResending: false,
    cancel: vi.fn(),
    resendMessages: vi.fn(),
    generatePreview: vi.fn(() => ''),
  },
}))

vi.mock('@/services/storage/backup-manager', () => ({
  backupManager: { listBackupsForAccount: vi.fn() },
}))

vi.mock('@/services/telegram/client', () => ({
  telegramService: { getDialogs: vi.fn() },
}))

const resendServiceMock = resendService as unknown as {
  isResending: boolean
  cancel: ReturnType<typeof vi.fn>
}

const emptyMediaTypes = {
  photos: 0,
  videos: 0,
  documents: 0,
  stickers: 0,
  voiceMessages: 0,
  videoNotes: 0,
  audio: 0,
  gifs: 0,
  polls: 0,
  locations: 0,
  contacts: 0,
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

function createBackup(overrides: Partial<Backup> = {}): Backup {
  return {
    id: 'backup-1',
    chatId: BigInt('1234567890'),
    chatTitle: 'Test Chat',
    chatType: 'channel',
    createdAt: new Date('2024-03-10T12:00:00Z'),
    messageCount: 10,
    mediaCount: 0,
    storageSize: 1024,
    hasMedia: false,
    mediaTypes: emptyMediaTypes,
    exportMode: 'all',
    ...overrides,
  }
}

function mountView(pinia: ReturnType<typeof createPinia>) {
  return mount(ResendView, {
    global: {
      plugins: [pinia, i18n],
      stubs: { RouterLink: { template: '<a><slot /></a>' } },
    },
  })
}

describe('ResendView account-switch guards', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(backupManager.listBackupsForAccount).mockReset()
    vi.mocked(telegramService.getDialogs).mockResolvedValue([])
    resendServiceMock.isResending = false

    pinia = createPinia()
    setActivePinia(pinia)
    const accounts = useAccountsStore()
    accounts.accounts = [createUserAccount(), createUserAccount({ id: 'acct-2', phone: '+1987654321' })]
    accounts.activeAccountId = 'acct-1'
  })

  it('discards a stale backup load that resolves after the account changed', async () => {
    let resolveFirst!: (backups: Backup[]) => void
    let resolveSecond!: (backups: Backup[]) => void
    const firstLoad = new Promise<Backup[]>((resolve) => {
      resolveFirst = resolve
    })
    const secondLoad = new Promise<Backup[]>((resolve) => {
      resolveSecond = resolve
    })
    vi.mocked(backupManager.listBackupsForAccount).mockImplementation((account) =>
      account?.id === 'acct-2' ? secondLoad : firstLoad,
    )

    const wrapper = mountView(pinia)
    await flushPromises()

    useAccountsStore().activeAccountId = 'acct-2'
    await flushPromises()

    resolveSecond([createBackup({ id: 'b-2', chatTitle: 'Account B Backup' })])
    await flushPromises()
    resolveFirst([createBackup({ id: 'b-1', chatTitle: 'Account A Backup' })])
    await flushPromises()

    expect(wrapper.text()).toContain('Account B Backup')
    expect(wrapper.text()).not.toContain('Account A Backup')
  })

  it('cancels an in-flight resend when the active account changes', async () => {
    vi.mocked(backupManager.listBackupsForAccount).mockResolvedValue([])

    mountView(pinia)
    await flushPromises()

    resendServiceMock.isResending = true
    useAccountsStore().activeAccountId = 'acct-2'
    await flushPromises()

    expect(resendServiceMock.cancel).toHaveBeenCalled()
  })
})
