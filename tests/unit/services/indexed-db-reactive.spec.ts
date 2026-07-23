import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { ChatExport, ChatMessage } from '@/types'

/**
 * The LLM export and account-journal writes persist records that originate from reactive UI/store
 * state (a selected chat's `peerRef`, an account's `principal`). Those carry Vue proxies, which
 * WebKit refuses to structured-clone. `indexed-db.ts` snapshots to plain data before `put`; these
 * tests exercise that real path end-to-end and assert the snapshot is lossless (bigint, Date, nested
 * refs all survive the round-trip).
 */
beforeEach(() => {
  ;(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  vi.resetModules()
})

function importIndexedDb() {
  return import('@/services/storage/indexed-db')
}

describe('indexed-db persistence of reactive-origin records', () => {
  it('round-trips a chat export whose peerRef comes from reactive state', async () => {
    const idb = await importIndexedDb()
    const createdAt = new Date('2026-03-04T05:06:07.000Z')

    // `peerRef` is read out of a reactive source, exactly like ChatExport is built from selectedChat.
    const chatInfo = reactive({ peerRef: { kind: 'channel' as const, rawId: '123', accessHash: '456' } })
    const chatExport: ChatExport = {
      id: 'export_reactive_1',
      chatId: 100200300400n,
      chatPeerId: '-100123',
      peerRef: chatInfo.peerRef,
      chatTitle: 'Reactive Chat',
      chatType: 'channel',
      schemaVersion: 2,
      createdAt,
      messageCount: 1,
      hasMedia: false,
      mediaCount: 0,
      dateRange: { from: createdAt, to: createdAt },
    }
    const messages: ChatMessage[] = reactive([
      {
        id: 1,
        chatId: 100200300400n,
        chatPeerId: '-100123',
        senderId: 42n,
        senderPeerId: '42',
        text: 'hello',
        date: createdAt,
        hasMedia: false,
      },
    ])

    await expect(idb.saveChatExportBundle(chatExport, messages)).resolves.toBeUndefined()

    const stored = await idb.getChatExport('export_reactive_1')
    expect(stored?.peerRef).toEqual({ kind: 'channel', rawId: '123', accessHash: '456' })
    expect(stored?.chatId).toBe(100200300400n)
    expect(stored?.createdAt).toBeInstanceOf(Date)
    expect(stored?.createdAt.getTime()).toBe(createdAt.getTime())

    const storedMessages = await idb.getChatMessagesByExport('export_reactive_1')
    expect(storedMessages).toHaveLength(1)
    expect(storedMessages[0]?.senderId).toBe(42n)
    expect(storedMessages[0]?.date).toBeInstanceOf(Date)
    expect(storedMessages[0]?.text).toBe('hello')
  })

  it('round-trips an account journal record whose principals come from a reactive account list', async () => {
    const idb = await importIndexedDb()

    const accounts = reactive([
      { id: 'a1', type: 'user', principal: { kind: 'user', telegramUserId: '111' } },
    ])

    await expect(
      idb.putAccountJournalRecord({
        id: 'a1',
        op: 'add',
        accountId: 'a1',
        metadata: { accounts, activeAccountId: 'a1' },
        createdAt: 1_700_000_000_000,
      }),
    ).resolves.toBeUndefined()

    const records = await idb.getAllAccountJournalRecords()
    expect(records).toHaveLength(1)
    expect(records[0]?.metadata).toEqual({
      accounts: [{ id: 'a1', type: 'user', principal: { kind: 'user', telegramUserId: '111' } }],
      activeAccountId: 'a1',
    })
  })
})
