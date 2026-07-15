import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backup, SavedAccount } from '@/types'

const state = vi.hoisted(() => ({
  backups: [] as Backup[],
}))

const dbMocks = vi.hoisted(() => ({
  calculateBackupSize: vi.fn(),
  countMediaTypes: vi.fn(),
  deleteBackup: vi.fn(),
  getAllBackups: vi.fn(async () => state.backups),
  getBackup: vi.fn(async (id: string) => state.backups.find((item) => item.id === id)),
  getMediaByBackup: vi.fn(),
  getMessagesByBackup: vi.fn(),
  saveBackup: vi.fn(async (backup: Backup) => {
    const index = state.backups.findIndex((item) => item.id === backup.id)
    if (index === -1) {
      state.backups.push(backup)
      return
    }

    state.backups[index] = backup
  }),
  saveBackupBundle: vi.fn(),
}))

vi.mock('@/services/storage/indexed-db', () => dbMocks)

import { backupManager } from '@/services/storage/backup-manager'

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

function createBackup(overrides: Partial<Backup> = {}): Backup {
  return {
    id: 'backup-1',
    chatId: BigInt('100123'),
    chatTitle: 'Test Chat',
    chatType: 'supergroup',
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

function createUserAccount(overrides: Partial<SavedAccount> = {}): SavedAccount {
  return {
    id: 'acct-1',
    type: 'user',
    label: 'Alice',
    phone: '+1234567890',
    sessionString: 'session',
    createdAt: new Date('2024-03-10T12:00:00Z'),
    lastUsedAt: new Date('2024-03-10T12:00:00Z'),
    ...overrides,
  }
}

describe('backupManager ownership', () => {
  beforeEach(() => {
    state.backups = []
    vi.clearAllMocks()
  })

  it('archives owned backups when an account is removed', async () => {
    const account = createUserAccount()

    state.backups = [
      createBackup({
        id: 'owned-backup',
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
      }),
      createBackup({
        id: 'legacy-backup',
        ownershipState: 'legacy',
      }),
    ]

    const archivedCount = await backupManager.archiveBackupsForRemovedAccount(account)

    expect(archivedCount).toBe(1)
    expect(dbMocks.saveBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'owned-backup',
        ownershipState: 'archived',
        archivedReason: 'account_removed',
        ownerAccountPhone: account.phone,
      }),
    )
  })

  it('recovers archived backups for the same phone and hides other accounts backups', async () => {
    const account = createUserAccount({ id: 'acct-new' })

    state.backups = [
      createBackup({
        id: 'owned-backup',
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
        createdAt: new Date('2024-03-12T12:00:00Z'),
      }),
      createBackup({
        id: 'archived-backup',
        ownerAccountId: 'acct-old',
        ownerAccountPhone: account.phone,
        ownershipState: 'archived',
        archivedAt: new Date('2024-03-11T12:00:00Z'),
      }),
      createBackup({
        id: 'legacy-backup',
        ownershipState: 'legacy',
        createdAt: new Date('2024-03-10T12:00:00Z'),
      }),
      createBackup({
        id: 'other-account-backup',
        ownerAccountId: 'acct-other',
        ownerAccountPhone: '+1987654321',
        ownershipState: 'owned',
        createdAt: new Date('2024-03-13T12:00:00Z'),
      }),
    ]

    const visibleBackups = await backupManager.listBackupsForAccount(account)

    expect(dbMocks.saveBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'archived-backup',
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
        archivedAt: undefined,
        archivedReason: undefined,
      }),
    )
    expect(visibleBackups.map((backup) => backup.id)).toEqual([
      'owned-backup',
      'archived-backup',
      'legacy-backup',
    ])
  })

  it('lists archived backups separately from active backups', async () => {
    state.backups = [
      createBackup({
        id: 'recent-archived-backup',
        ownerAccountId: 'acct-old',
        ownerAccountPhone: '+1234567890',
        ownershipState: 'archived',
        archivedAt: new Date('2024-03-12T12:00:00Z'),
      }),
      createBackup({
        id: 'older-archived-backup',
        ownerAccountId: 'acct-older',
        ownerAccountPhone: '+1987654321',
        ownershipState: 'archived',
        archivedAt: new Date('2024-03-11T12:00:00Z'),
      }),
      createBackup({
        id: 'owned-backup',
        ownerAccountId: 'acct-1',
        ownerAccountPhone: '+1234567890',
        ownershipState: 'owned',
      }),
    ]

    const archivedBackups = await backupManager.listArchivedBackups()

    expect(archivedBackups.map((backup) => backup.id)).toEqual([
      'recent-archived-backup',
      'older-archived-backup',
    ])
  })

  it('stamps the owning principal and verified state on new backups', async () => {
    dbMocks.countMediaTypes.mockResolvedValue(emptyMediaTypes)
    const account = createUserAccount({ principal: { kind: 'user', telegramUserId: '500' } })

    const backup = await backupManager.createBackup(
      { chatId: BigInt('1'), chatTitle: 'Chat', exportMode: 'all', storageStrategy: 'indexeddb' },
      [],
      new Map(),
      account,
    )

    expect(backup).toMatchObject({
      ownerPrincipal: { kind: 'user', telegramUserId: '500' },
      ownerVerification: 'verified',
      lifecycle: 'active',
      ownershipState: 'owned',
    })
    expect(dbMocks.saveBackupBundle).toHaveBeenCalled()
  })

  it('recovers archived backups by principal across a new local account id and phone', async () => {
    // Same Telegram identity, but a fresh install: different local UUID and re-formatted phone.
    const reinstalledAccount = createUserAccount({
      id: 'acct-new',
      phone: '+40000000',
      principal: { kind: 'user', telegramUserId: '500' },
    })

    state.backups = [
      createBackup({
        id: 'archived-by-principal',
        ownerAccountId: 'acct-old',
        ownerAccountPhone: '+1234567890',
        ownerPrincipal: { kind: 'user', telegramUserId: '500' },
        ownershipState: 'archived',
        archivedAt: new Date('2024-03-11T12:00:00Z'),
      }),
    ]

    const visible = await backupManager.listBackupsForAccount(reinstalledAccount)

    expect(dbMocks.saveBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'archived-by-principal',
        ownerAccountId: 'acct-new',
        ownerVerification: 'verified',
        lifecycle: 'active',
        archivedAt: undefined,
      }),
    )
    expect(visible.map((backup) => backup.id)).toEqual(['archived-by-principal'])
  })

  it('never recovers or shows another principal\'s archived backups', async () => {
    const otherAccount = createUserAccount({
      id: 'acct-other',
      principal: { kind: 'user', telegramUserId: '999' },
    })

    state.backups = [
      createBackup({
        id: 'archived-by-principal',
        ownerAccountId: 'acct-old',
        ownerAccountPhone: '+1234567890',
        ownerPrincipal: { kind: 'user', telegramUserId: '500' },
        ownershipState: 'archived',
        archivedAt: new Date('2024-03-11T12:00:00Z'),
      }),
    ]

    const visible = await backupManager.listBackupsForAccount(otherAccount)

    expect(visible).toEqual([])
    expect(dbMocks.saveBackup).not.toHaveBeenCalled()
  })

  it('archives verified backups by principal even when the local account id changed', async () => {
    // A verified backup owned by principal 500, created under an old local UUID.
    const reinstalledAccount = createUserAccount({
      id: 'acct-new',
      principal: { kind: 'user', telegramUserId: '500' },
    })
    state.backups = [
      createBackup({
        id: 'verified-backup',
        ownerAccountId: 'acct-old',
        ownerPrincipal: { kind: 'user', telegramUserId: '500' },
        ownershipState: 'owned',
      }),
    ]

    const archivedCount = await backupManager.archiveBackupsForRemovedAccount(reinstalledAccount)

    expect(archivedCount).toBe(1)
    expect(dbMocks.saveBackup).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'verified-backup', lifecycle: 'archived' }),
    )
  })

  it('surfaces records with lost owner metadata as quarantined instead of hiding them', async () => {
    const account = createUserAccount({ principal: { kind: 'user', telegramUserId: '500' } })

    state.backups = [
      createBackup({
        id: 'healthy-backup',
        ownerAccountId: account.id,
        ownerPrincipal: { kind: 'user', telegramUserId: '500' },
        ownershipState: 'owned',
      }),
      createBackup({
        // verified marker but the principal was lost -> internally inconsistent.
        id: 'broken-backup',
        ownerVerification: 'verified',
        ownershipState: 'owned',
      }),
    ]

    // A quarantined record must never be silently exposed as owned or visible.
    const visible = await backupManager.listBackupsForAccount(account)
    expect(visible.map((backup) => backup.id)).toEqual(['healthy-backup'])

    const quarantined = await backupManager.listQuarantinedBackups()
    expect(quarantined.map((backup) => backup.id)).toEqual(['broken-backup'])
  })

  it('reconciles a quarantined backup to the current account on explicit repair', async () => {
    const account = createUserAccount({ principal: { kind: 'user', telegramUserId: '500' } })

    state.backups = [
      createBackup({
        id: 'broken-backup',
        ownerVerification: 'verified',
        ownershipState: 'owned',
      }),
    ]

    const reconciled = await backupManager.reconcileBackup('broken-backup', account)

    expect(reconciled).toMatchObject({
      id: 'broken-backup',
      ownerAccountId: account.id,
      ownerPrincipal: { kind: 'user', telegramUserId: '500' },
      ownerVerification: 'verified',
      recordHealth: 'healthy',
      ownershipState: 'owned',
    })
    expect(await backupManager.listQuarantinedBackups()).toEqual([])
  })

  it('refuses to reconcile a healthy backup owned by someone else', async () => {
    const account = createUserAccount({ principal: { kind: 'user', telegramUserId: '500' } })

    state.backups = [
      createBackup({
        id: 'other-owner-backup',
        ownerAccountId: 'acct-other',
        ownerPrincipal: { kind: 'user', telegramUserId: '999' },
        ownershipState: 'owned',
      }),
    ]

    await expect(backupManager.reconcileBackup('other-owner-backup', account)).rejects.toThrow(
      /quarantined or legacy/,
    )
    expect(dbMocks.saveBackup).not.toHaveBeenCalled()
  })

  it('claims a legacy backup for the current account', async () => {
    const account = createUserAccount()

    state.backups = [
      createBackup({
        id: 'legacy-backup',
        ownershipState: 'legacy',
      }),
    ]

    const claimedBackup = await backupManager.claimLegacyBackup('legacy-backup', account)

    expect(dbMocks.saveBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'legacy-backup',
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
      }),
    )
    expect(claimedBackup).toEqual(
      expect.objectContaining({
        id: 'legacy-backup',
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
      }),
    )
  })
})

describe('backupManager createBackup commit fence', () => {
  beforeEach(() => {
    state.backups = []
    vi.clearAllMocks()
    dbMocks.countMediaTypes.mockResolvedValue(emptyMediaTypes)
  })

  it('runs ensureCommittable immediately before writing the bundle', async () => {
    const account = createUserAccount()
    const order: string[] = []
    dbMocks.saveBackupBundle.mockImplementation(async () => {
      order.push('save')
    })
    const ensureCommittable = vi.fn(() => {
      order.push('ensure')
    })

    await backupManager.createBackup(
      { chatId: BigInt('100123'), chatTitle: 'Test', exportMode: 'all' },
      [],
      new Map(),
      account,
      { ensureCommittable },
    )

    expect(ensureCommittable).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['ensure', 'save'])
  })

  it('does not persist the bundle when ensureCommittable rejects the commit', async () => {
    const account = createUserAccount()
    const ensureCommittable = vi.fn(() => {
      throw new DOMException('Owning account was removed during export', 'AbortError')
    })

    await expect(
      backupManager.createBackup(
        { chatId: BigInt('100123'), chatTitle: 'Test', exportMode: 'all' },
        [],
        new Map(),
        account,
        { ensureCommittable },
      ),
    ).rejects.toThrow('Owning account was removed during export')

    expect(dbMocks.saveBackupBundle).not.toHaveBeenCalled()
  })
})
