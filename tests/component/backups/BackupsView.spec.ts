import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { backupManager } from '@/services/storage/backup-manager'
import { quotaManager } from '@/services/storage/quota'
import { useAccountsStore, useBackupsStore, useUiStore } from '@/stores'
import type { Backup, SavedAccount } from '@/types'
import BackupsView from '@/views/BackupsView.vue'

vi.mock('@/services/storage/backup-manager', () => ({
  backupManager: {
    listBackupsForAccount: vi.fn(),
    listArchivedBackups: vi.fn(),
    listQuarantinedBackups: vi.fn(),
    claimLegacyBackup: vi.fn(),
    reconcileBackup: vi.fn(),
    exportBackupToZip: vi.fn(),
    deleteBackup: vi.fn(),
  },
}))

vi.mock('@/services/storage/quota', () => ({
  quotaManager: {
    getStorageEstimate: vi.fn(),
    getPersistenceStatus: vi.fn().mockResolvedValue('persisted'),
  },
}))

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
    chatId: BigInt('-1001234567890'),
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

describe('BackupsView', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    vi.clearAllMocks()
    pinia = createPinia()
    setActivePinia(pinia)

    const accountsStore = useAccountsStore()
    accountsStore.accounts = [createUserAccount()]
    accountsStore.activeAccountId = 'acct-1'

    vi.mocked(quotaManager.getStorageEstimate).mockResolvedValue({
      used: 1024,
      available: 2048,
      percentUsed: 33,
    })
    vi.mocked(backupManager.listQuarantinedBackups).mockResolvedValue([])
  })

  it('renders legacy and archived lifecycle states', async () => {
    vi.mocked(backupManager.listBackupsForAccount).mockResolvedValue([
      createBackup({
        id: 'legacy-backup',
        chatTitle: 'Legacy Backup',
        ownershipState: 'legacy',
      }),
    ])
    vi.mocked(backupManager.listArchivedBackups).mockResolvedValue([
      createBackup({
        id: 'archived-backup',
        chatTitle: 'Archived Backup',
        ownershipState: 'archived',
        ownerAccountPhone: '+1987654321',
        archivedAt: new Date('2024-03-11T12:00:00Z'),
      }),
    ])

    const wrapper = mount(BackupsView, {
      global: {
        plugins: [pinia, i18n],
        stubs: {
          RouterLink: {
            template: '<a><slot /></a>',
          },
        },
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Unassigned local data')
    expect(wrapper.text()).toContain('Archived local backups')
    expect(wrapper.text()).toContain('Removed account: +1987654321')
  })

  it('claims a legacy backup and reloads the list', async () => {
    const account = createUserAccount()
    const legacyBackup = createBackup({
      id: 'legacy-backup',
      chatTitle: 'Legacy Backup',
      ownershipState: 'legacy',
    })

    vi.mocked(backupManager.listBackupsForAccount)
      .mockResolvedValueOnce([legacyBackup])
      .mockResolvedValueOnce([
        createBackup({
          ...legacyBackup,
          ownerAccountId: account.id,
          ownerAccountPhone: account.phone,
          ownershipState: 'owned',
        }),
      ])
    vi.mocked(backupManager.listArchivedBackups).mockResolvedValue([])
    vi.mocked(backupManager.claimLegacyBackup).mockResolvedValue(
      createBackup({
        ...legacyBackup,
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
      }),
    )

    const wrapper = mount(BackupsView, {
      global: {
        plugins: [pinia, i18n],
        stubs: {
          RouterLink: {
            template: '<a><slot /></a>',
          },
        },
      },
    })

    await flushPromises()
    const claimButton = wrapper.findAll('button').find((button) => button.text() === 'Claim')
    expect(claimButton).toBeDefined()
    await claimButton!.trigger('click')
    await flushPromises()

    const uiStore = useUiStore()
    const backupsStore = useBackupsStore()

    expect(backupManager.claimLegacyBackup).toHaveBeenCalledWith('legacy-backup', account)
    expect(backupManager.listBackupsForAccount).toHaveBeenCalledTimes(2)
    expect(uiStore.toasts[0]?.message).toBe('Backup assigned to this account.')
    expect(backupsStore.backups[0]?.ownershipState).toBe('owned')
  })

  it('surfaces quarantined backups and repairs them on demand', async () => {
    const account = createUserAccount()
    vi.mocked(backupManager.listBackupsForAccount).mockResolvedValue([])
    vi.mocked(backupManager.listArchivedBackups).mockResolvedValue([])
    vi.mocked(backupManager.listQuarantinedBackups)
      .mockResolvedValueOnce([
        createBackup({
          id: 'broken-backup',
          chatTitle: 'Broken Backup',
          ownerVerification: 'verified',
          ownershipState: 'owned',
        }),
      ])
      .mockResolvedValueOnce([])
    vi.mocked(backupManager.reconcileBackup).mockResolvedValue(
      createBackup({ id: 'broken-backup', chatTitle: 'Broken Backup', ownershipState: 'owned' }),
    )

    const wrapper = mount(BackupsView, {
      global: {
        plugins: [pinia, i18n],
        stubs: {
          RouterLink: {
            template: '<a><slot /></a>',
          },
        },
      },
    })

    await flushPromises()
    expect(wrapper.text()).toContain('Broken Backup')

    const repairButton = wrapper.findAll('button').find((button) => button.text() === 'Repair')
    expect(repairButton).toBeDefined()
    await repairButton!.trigger('click')
    await flushPromises()

    expect(backupManager.reconcileBackup).toHaveBeenCalledWith('broken-backup', account)
    expect(useUiStore().toasts[0]?.message).toBe('Backup restored to this account.')
  })

  it('shows load failures instead of a valid empty state', async () => {
    vi.mocked(backupManager.listBackupsForAccount).mockRejectedValue(
      new Error('Storage is unavailable'),
    )
    vi.mocked(backupManager.listArchivedBackups).mockResolvedValue([])

    const wrapper = mount(BackupsView, {
      global: {
        plugins: [pinia, i18n],
        stubs: {
          RouterLink: {
            template: '<a><slot /></a>',
          },
        },
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Storage is unavailable')
    expect(wrapper.text()).toContain('Try Again')
    expect(wrapper.text()).not.toContain('No backups yet')
  })

  it('discards a stale account load that resolves after a newer account', async () => {
    const accountsStore = useAccountsStore()
    const secondAccount = createUserAccount({ id: 'acct-2', phone: '+1987654321' })
    accountsStore.accounts.push(secondAccount)

    let resolveFirst!: (backups: Backup[]) => void
    let resolveSecond!: (backups: Backup[]) => void
    const firstLoad = new Promise<Backup[]>((resolve) => {
      resolveFirst = resolve
    })
    const secondLoad = new Promise<Backup[]>((resolve) => {
      resolveSecond = resolve
    })

    vi.mocked(backupManager.listBackupsForAccount).mockImplementation((account) =>
      account?.id === secondAccount.id ? secondLoad : firstLoad,
    )
    vi.mocked(backupManager.listArchivedBackups).mockResolvedValue([])

    const wrapper = mount(BackupsView, {
      global: {
        plugins: [pinia, i18n],
        stubs: {
          RouterLink: {
            template: '<a><slot /></a>',
          },
        },
      },
    })

    accountsStore.activeAccountId = secondAccount.id
    await flushPromises()

    resolveSecond([createBackup({ id: 'second-backup', chatTitle: 'Second account' })])
    await flushPromises()
    resolveFirst([createBackup({ id: 'first-backup', chatTitle: 'First account' })])
    await flushPromises()

    expect(wrapper.text()).toContain('Second account')
    expect(wrapper.text()).not.toContain('First account')
    expect(useBackupsStore().backups.map((backup) => backup.id)).toEqual(['second-backup'])
  })
})
