import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  countBackupMessages: vi.fn(),
  countChatExportMessages: vi.fn(),
}))

vi.mock('@/services/storage/indexed-db', () => dbMock)

import {
  isBackupContentEvicted,
  isChatExportContentEvicted,
  listEvictedBackupIds,
  listEvictedChatExportIds,
} from '@/services/storage/content-health'

describe('content-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('flags a backup that claims content but has no stored messages', async () => {
    dbMock.countBackupMessages.mockResolvedValue(0)
    expect(await isBackupContentEvicted({ id: 'a', messageCount: 5 })).toBe(true)
  })

  it('does not flag a backup whose messages are still present', async () => {
    dbMock.countBackupMessages.mockResolvedValue(5)
    expect(await isBackupContentEvicted({ id: 'a', messageCount: 5 })).toBe(false)
  })

  it('never probes an empty backup (messageCount 0 is not eviction)', async () => {
    expect(await isBackupContentEvicted({ id: 'a', messageCount: 0 })).toBe(false)
    expect(dbMock.countBackupMessages).not.toHaveBeenCalled()
  })

  it('flags an evicted chat export the same way', async () => {
    dbMock.countChatExportMessages.mockResolvedValue(0)
    expect(await isChatExportContentEvicted({ id: 'e', messageCount: 3 })).toBe(true)
  })

  it('returns only the evicted ids and treats a probe failure as healthy', async () => {
    dbMock.countBackupMessages.mockImplementation(async (id: string) => {
      if (id === 'evicted') return 0
      if (id === 'broken') throw new Error('read failed')
      return 4
    })

    const evicted = await listEvictedBackupIds([
      { id: 'healthy', messageCount: 4 },
      { id: 'evicted', messageCount: 4 },
      { id: 'broken', messageCount: 4 },
    ])

    expect([...evicted]).toEqual(['evicted'])
  })

  it('returns only the evicted chat-export ids and treats a probe failure as healthy', async () => {
    dbMock.countChatExportMessages.mockImplementation(async (id: string) => {
      if (id === 'evicted') return 0
      if (id === 'broken') throw new Error('read failed')
      return 7
    })

    const evicted = await listEvictedChatExportIds([
      { id: 'healthy', messageCount: 7 },
      { id: 'evicted', messageCount: 7 },
      { id: 'broken', messageCount: 7 },
    ])

    expect([...evicted]).toEqual(['evicted'])
  })
})
