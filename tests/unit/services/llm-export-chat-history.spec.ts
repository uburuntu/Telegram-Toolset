import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatExport, ChatInfo, ChatMessage } from '@/types'

const { saveChatExportBundle } = vi.hoisted(() => ({
  saveChatExportBundle: vi.fn(),
}))

vi.mock('@/services/llm-export/store', () => ({
  deleteChatExport: vi.fn(),
  getChatMessages: vi.fn(),
  getTotalStorageSize: vi.fn(),
  listChatExports: vi.fn(),
  loadChatExportBundle: vi.fn(),
  saveChatExportBundle,
}))

vi.mock('@/services/telegram/client', () => ({
  telegramService: {
    getChatMessageCount: vi.fn(),
    iterChatMessages: vi.fn(),
    resolveSenderInfo: vi.fn(),
  },
}))

vi.mock('@/services/telegram/rate-limiter', () => ({
  createFloodWaitSubscription: vi.fn(() => () => {}),
}))

import { chatHistoryService } from '@/services/llm-export/chat-history-service'
import { telegramService } from '@/services/telegram/client'

const chatInfo: ChatInfo = {
  id: BigInt('1234567890'),
  peerId: '-1001234567890',
  title: 'History Chat',
  type: 'supergroup',
  canExport: true,
  canSend: true,
  isAdmin: true,
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    chatId: chatInfo.id,
    chatPeerId: chatInfo.peerId,
    senderId: BigInt('10'),
    senderPeerId: '10',
    date: new Date('2024-03-10T10:00:00Z'),
    hasMedia: false,
    text: 'Hello',
    ...overrides,
  }
}

describe('chatHistoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(telegramService.getChatMessageCount).mockResolvedValue(2)
    vi.mocked(telegramService.resolveSenderInfo).mockResolvedValue({
      name: 'Alice',
      username: 'alice',
    })
    saveChatExportBundle.mockImplementation(
      async (chatExport: ChatExport, messages: ChatMessage[]) => ({
        chatExport,
        messages,
      }),
    )
  })

  it('persists chat and sender peer identifiers via the bundle store', async () => {
    vi.mocked(telegramService.iterChatMessages).mockImplementation(async function* () {
      yield makeMessage()
    })

    const result = await chatHistoryService.downloadChatHistory(chatInfo)

    expect(telegramService.getChatMessageCount).toHaveBeenCalledWith(chatInfo.peerId)
    expect(saveChatExportBundle).toHaveBeenCalledTimes(1)
    expect(saveChatExportBundle.mock.calls[0]?.[0]).toMatchObject({
      chatId: chatInfo.id,
      chatPeerId: chatInfo.peerId,
      schemaVersion: 2,
    })
    expect(saveChatExportBundle.mock.calls[0]?.[1]?.[0]).toMatchObject({
      chatPeerId: chatInfo.peerId,
      senderPeerId: '10',
      senderName: 'Alice',
      senderUsername: 'alice',
    })
    expect(result.chatExport.chatPeerId).toBe(chatInfo.peerId)
  })

  it('supports stop-and-save on a request-scoped task', async () => {
    vi.mocked(telegramService.iterChatMessages).mockImplementation(async function* () {
      yield makeMessage({ id: 1, text: 'First' })
      yield makeMessage({ id: 2, text: 'Second', date: new Date('2024-03-10T10:01:00Z') })
    })

    const task = chatHistoryService.createDownloadTask(chatInfo, {}, {
      onMessage: () => {
        task.stopAndSave()
      },
    })

    const result = await task.promise

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.text).toBe('First')
    expect(saveChatExportBundle.mock.calls[0]?.[1]).toHaveLength(1)
  })
})
