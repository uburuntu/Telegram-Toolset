import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatExport, SavedAccount } from '@/types'

const state = vi.hoisted(() => ({
  chatExports: [] as ChatExport[],
}))

const dbMocks = vi.hoisted(() => ({
  deleteChatExport: vi.fn(),
  getAllChatExports: vi.fn(async () => state.chatExports),
  getChatExport: vi.fn(async (id: string) => state.chatExports.find((item) => item.id === id)),
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
  claimLegacyChatExport,
  listArchivedChatExports,
  listChatExportsForAccount,
  listQuarantinedChatExports,
  reconcileChatExport,
  saveChatExportBundle,
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

  it('lists archived chat exports separately from active exports', async () => {
    state.chatExports = [
      createChatExport({
        id: 'recent-archived-export',
        ownerAccountId: 'acct-old',
        ownerAccountPhone: '+1234567890',
        ownershipState: 'archived',
        archivedAt: new Date('2024-03-12T12:00:00Z'),
      }),
      createChatExport({
        id: 'older-archived-export',
        ownerAccountId: 'acct-older',
        ownerAccountPhone: '+1987654321',
        ownershipState: 'archived',
        archivedAt: new Date('2024-03-11T12:00:00Z'),
      }),
      createChatExport({
        id: 'owned-export',
        ownerAccountId: 'acct-1',
        ownerAccountPhone: '+1234567890',
        ownershipState: 'owned',
      }),
    ]

    const archivedExports = await listArchivedChatExports()

    expect(archivedExports.map((chatExport) => chatExport.id)).toEqual([
      'recent-archived-export',
      'older-archived-export',
    ])
  })

  it('surfaces exports with lost owner metadata as quarantined instead of hiding them', async () => {
    const account = createUserAccount({ principal: { kind: 'user', telegramUserId: '500' } })

    state.chatExports = [
      createChatExport({
        id: 'healthy-export',
        ownerAccountId: account.id,
        ownerPrincipal: { kind: 'user', telegramUserId: '500' },
        ownershipState: 'owned',
      }),
      createChatExport({
        id: 'broken-export',
        ownerVerification: 'verified',
        ownershipState: 'owned',
      }),
    ]

    const visible = await listChatExportsForAccount(account)
    expect(visible.map((chatExport) => chatExport.id)).toEqual(['healthy-export'])

    const quarantined = await listQuarantinedChatExports()
    expect(quarantined.map((chatExport) => chatExport.id)).toEqual(['broken-export'])
  })

  it('reconciles a quarantined export to the current account on explicit repair', async () => {
    const account = createUserAccount({ principal: { kind: 'user', telegramUserId: '500' } })

    state.chatExports = [
      createChatExport({
        id: 'broken-export',
        ownerVerification: 'verified',
        ownershipState: 'owned',
      }),
    ]

    const reconciled = await reconcileChatExport('broken-export', account)

    expect(reconciled).toMatchObject({
      id: 'broken-export',
      ownerAccountId: account.id,
      ownerPrincipal: { kind: 'user', telegramUserId: '500' },
      ownerVerification: 'verified',
      recordHealth: 'healthy',
      ownershipState: 'owned',
    })
    expect(await listQuarantinedChatExports()).toEqual([])
  })

  it('refuses to reconcile a healthy export owned by someone else', async () => {
    const account = createUserAccount({ principal: { kind: 'user', telegramUserId: '500' } })

    state.chatExports = [
      createChatExport({
        id: 'other-owner-export',
        ownerAccountId: 'acct-other',
        ownerPrincipal: { kind: 'user', telegramUserId: '999' },
        ownershipState: 'owned',
      }),
    ]

    await expect(reconcileChatExport('other-owner-export', account)).rejects.toThrow(
      /quarantined or legacy/,
    )
    expect(dbMocks.saveChatExport).not.toHaveBeenCalled()
  })

  it('claims a legacy chat export for the current account', async () => {
    const account = createUserAccount()

    state.chatExports = [
      createChatExport({
        id: 'legacy-export',
        ownershipState: 'legacy',
      }),
    ]

    const claimedExport = await claimLegacyChatExport('legacy-export', account)

    expect(dbMocks.saveChatExport).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'legacy-export',
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
      }),
    )
    expect(claimedExport).toEqual(
      expect.objectContaining({
        id: 'legacy-export',
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
      }),
    )
  })
})

describe('saveChatExportBundle commit fence', () => {
  beforeEach(() => {
    state.chatExports = []
    vi.clearAllMocks()
  })

  it('runs ensureCommittable immediately before writing the bundle', async () => {
    const order: string[] = []
    dbMocks.saveChatExportBundle.mockImplementation(async () => {
      order.push('save')
    })
    const ensureCommittable = vi.fn(() => {
      order.push('ensure')
    })

    await saveChatExportBundle(createChatExport(), [], { ensureCommittable })

    expect(ensureCommittable).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['ensure', 'save'])
  })

  it('does not persist the bundle when ensureCommittable rejects the commit', async () => {
    const ensureCommittable = vi.fn(() => {
      throw new DOMException('Owning account was removed during export', 'AbortError')
    })

    await expect(
      saveChatExportBundle(createChatExport(), [], { ensureCommittable }),
    ).rejects.toThrow('Owning account was removed during export')

    expect(dbMocks.saveChatExportBundle).not.toHaveBeenCalled()
  })
})
