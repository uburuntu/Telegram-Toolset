import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backup, ChatExport } from '@/types'

const backupManagerMock = vi.hoisted(() => ({ listBackups: vi.fn() }))
const chatHistoryMock = vi.hoisted(() => ({ listChatExports: vi.fn() }))
const dbMock = vi.hoisted(() => ({
  getChatExportSize: vi.fn(async () => 0),
  deleteBackup: vi.fn(async () => {}),
  deleteChatExport: vi.fn(async () => {}),
}))

vi.mock('@/services/storage/backup-manager', () => ({ backupManager: backupManagerMock }))
vi.mock('@/services/llm-export/chat-history-service', () => ({
  chatHistoryService: chatHistoryMock,
}))
vi.mock('@/services/storage/indexed-db', () => dbMock)

import { getLocalDataInventory, purgeRetainedLocalData } from '@/services/storage/local-data-service'

function backup(overrides: Partial<Backup>): Backup {
  return {
    id: 'b',
    chatId: BigInt(1),
    chatTitle: 'Chat',
    chatType: 'channel',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    messageCount: 3,
    mediaCount: 0,
    storageSize: 100,
    hasMedia: false,
    mediaTypes: {
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
    },
    exportMode: 'all',
    ...overrides,
  } as Backup
}

function chatExport(overrides: Partial<ChatExport>): ChatExport {
  return {
    id: 'e',
    chatId: BigInt(2),
    chatTitle: 'Export',
    chatType: 'user',
    createdAt: new Date('2026-02-01T00:00:00Z'),
    messageCount: 5,
    dateRange: { from: new Date('2026-01-01Z'), to: new Date('2026-02-01Z') },
    ...overrides,
  } as ChatExport
}

describe('local-data-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.getChatExportSize.mockResolvedValue(50)
  })

  it('lists only orphaned (archived/quarantined/legacy) records, excluding active-owned', async () => {
    backupManagerMock.listBackups.mockResolvedValue([
      backup({ id: 'active', ownershipState: 'owned', ownerVerification: 'verified', lifecycle: 'active', ownerPrincipal: { kind: 'user', telegramUserId: '1' } }),
      backup({ id: 'archived', ownershipState: 'archived', lifecycle: 'archived', ownerVerification: 'verified', ownerPrincipal: { kind: 'user', telegramUserId: '1' }, archivedReason: 'account_removed' }),
      backup({ id: 'legacy', ownershipState: 'legacy' }),
    ])
    chatHistoryMock.listChatExports.mockResolvedValue([
      chatExport({ id: 'quarantined', ownerVerification: 'legacy', ownerPrincipal: { kind: 'user', telegramUserId: '9' } }),
    ])

    const inventory = await getLocalDataInventory()

    const ids = inventory.records.map((record) => record.id)
    expect(ids).toContain('archived')
    expect(ids).toContain('legacy')
    expect(ids).toContain('quarantined')
    expect(ids).not.toContain('active')

    const quarantined = inventory.records.find((record) => record.id === 'quarantined')
    expect(quarantined?.health).toBe('quarantined')
    expect(quarantined?.sizeBytes).toBe(50)

    // 100 (archived backup) + 100 (legacy backup) + 50 (quarantined export)
    expect(inventory.totalSizeBytes).toBe(250)
  })

  it('purges exactly the listed orphan records and reports counts', async () => {
    backupManagerMock.listBackups.mockResolvedValue([
      backup({ id: 'active', ownershipState: 'owned', ownerVerification: 'verified', lifecycle: 'active', ownerPrincipal: { kind: 'user', telegramUserId: '1' } }),
      backup({ id: 'archived', ownershipState: 'archived', lifecycle: 'archived', ownerVerification: 'verified', ownerPrincipal: { kind: 'user', telegramUserId: '1' } }),
    ])
    chatHistoryMock.listChatExports.mockResolvedValue([
      chatExport({ id: 'legacy-export', ownershipState: 'legacy' }),
    ])

    const summary = await purgeRetainedLocalData()

    expect(summary).toEqual({ backups: 1, chatExports: 1 })
    expect(dbMock.deleteBackup).toHaveBeenCalledWith('archived')
    expect(dbMock.deleteBackup).not.toHaveBeenCalledWith('active')
    expect(dbMock.deleteChatExport).toHaveBeenCalledWith('legacy-export')
  })
})
