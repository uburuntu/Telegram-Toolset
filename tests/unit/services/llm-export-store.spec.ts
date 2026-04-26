import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatExport, SavedAccount } from '@/types'

const state = vi.hoisted(() => ({
  chatExports: [] as ChatExport[],
}))

const dbMocks = vi.hoisted(() => ({
  deleteChatExport: vi.fn(),
  getAllChatExports: vi.fn(async () => state.chatExports),
  getChatExport: vi.fn(),
  getChatExportSize: vi.fn(),
  getChatMessagesByExport: vi.fn(),
  saveChatExport: vi.fn(async (chatExport: ChatExport) => {
    const index = state.chatExports.findIndex((item) => item.id === chatExport.id)
    if (index === -1) {
      state.chatExports.push(chatExport)
      return
    }

    state.chatExports[index] = chatExport
  }),
  saveChatExportBundle: vi.fn(),
}))

vi.mock('@/services/storage/indexed-db', () => dbMocks)

import {
  archiveChatExportsForRemovedAccount,
  listChatExportsForAccount,
} from '@/services/llm-export/store'

function createChatExport(overrides: Partial<ChatExport> = {}): ChatExport {
  return {
    id: 'export-1',
    chatId: BigInt('100123'),
    chatPeerId: '-100100123',
    chatTitle: 'Test Chat',
    chatType: 'supergroup',
    schemaVersion: 2,
    createdAt: new Date('2024-03-10T12:00:00Z'),
    messageCount: 10,
    hasMedia: true,
    mediaCount: 2,
    dateRange: {
      from: new Date('2024-03-10T10:00:00Z'),
      to: new Date('2024-03-10T12:00:00Z'),
    },
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

describe('llm export ownership', () => {
  beforeEach(() => {
    state.chatExports = []
    vi.clearAllMocks()
  })

  it('archives owned exports when an account is removed', async () => {
    const account = createUserAccount()

    state.chatExports = [
      createChatExport({
        id: 'owned-export',
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
      }),
      createChatExport({
        id: 'legacy-export',
        ownershipState: 'legacy',
      }),
    ]

    const archivedCount = await archiveChatExportsForRemovedAccount(account)

    expect(archivedCount).toBe(1)
    expect(dbMocks.saveChatExport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'owned-export',
        ownershipState: 'archived',
        archivedReason: 'account_removed',
        ownerAccountPhone: account.phone,
      }),
    )
  })

  it('recovers archived exports for the same phone and keeps other accounts exports hidden', async () => {
    const account = createUserAccount({ id: 'acct-new' })

    state.chatExports = [
      createChatExport({
        id: 'owned-export',
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
        createdAt: new Date('2024-03-12T12:00:00Z'),
      }),
      createChatExport({
        id: 'archived-export',
        ownerAccountId: 'acct-old',
        ownerAccountPhone: account.phone,
        ownershipState: 'archived',
        archivedAt: new Date('2024-03-11T12:00:00Z'),
      }),
      createChatExport({
        id: 'legacy-export',
        ownershipState: 'legacy',
        createdAt: new Date('2024-03-10T12:00:00Z'),
      }),
      createChatExport({
        id: 'other-account-export',
        ownerAccountId: 'acct-other',
        ownerAccountPhone: '+1987654321',
        ownershipState: 'owned',
        createdAt: new Date('2024-03-13T12:00:00Z'),
      }),
    ]

    const visibleExports = await listChatExportsForAccount(account)

    expect(dbMocks.saveChatExport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'archived-export',
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
        archivedAt: undefined,
        archivedReason: undefined,
      }),
    )
    expect(visibleExports.map((chatExport) => chatExport.id)).toEqual([
      'owned-export',
      'archived-export',
      'legacy-export',
    ])
  })
})
