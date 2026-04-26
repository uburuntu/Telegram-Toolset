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
  getBackup: vi.fn(),
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
})
