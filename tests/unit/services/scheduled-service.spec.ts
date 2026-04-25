import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatInfo, ScheduledMessage } from '@/types'

const { createFloodWaitSubscription, withRetry, formatRelativeTimeFromNow } = vi.hoisted(() => ({
  createFloodWaitSubscription: vi.fn(() => vi.fn()),
  withRetry: vi.fn((operation: () => Promise<unknown>) => operation()),
  formatRelativeTimeFromNow: vi.fn(() => 'in 1 hour'),
}))

vi.mock('@/services/telegram/gateway', () => ({
  telegramGateway: {
    auth: {
      onFloodWait: vi.fn(() => () => {}),
    },
    dialogs: {
      getDialogs: vi.fn(),
    },
    scheduled: {
      getScheduledMessages: vi.fn(),
      deleteScheduledMessages: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

vi.mock('@/services/telegram/rate-limiter', () => ({
  createFloodWaitSubscription,
  withRetry,
}))

vi.mock('@/utils/locale-format', () => ({
  formatRelativeTimeFromNow,
}))

import { scheduledService } from '@/services/scheduled/scheduled-service'
import { telegramGateway } from '@/services/telegram/gateway'

const groupChat: ChatInfo = {
  id: BigInt('-1001234567890'),
  peerId: '-1001234567890',
  title: 'Core Group',
  type: 'supergroup',
  canExport: true,
  canSend: true,
  isAdmin: true,
}

const adminChannel: ChatInfo = {
  id: BigInt('-1001234567891'),
  peerId: '-1001234567891',
  title: 'Admin Channel',
  type: 'channel',
  canExport: true,
  canSend: true,
  isAdmin: true,
}

const memberChannel: ChatInfo = {
  id: BigInt('-1001234567892'),
  peerId: '-1001234567892',
  title: 'Read Only Channel',
  type: 'channel',
  canExport: false,
  canSend: false,
  isAdmin: false,
}

function makeScheduledMessage(
  id: number,
  chatId: bigint,
  text: string,
  scheduledDate = new Date('2024-03-10T13:00:00Z'),
): ScheduledMessage {
  return {
    id,
    chatId,
    text,
    date: new Date('2024-03-10T12:00:00Z'),
    scheduledDate,
    hasMedia: false,
  }
}

describe('scheduledService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads scheduled messages for a single chat through the gateway', async () => {
    const unsubscribe = vi.fn()
    createFloodWaitSubscription.mockReturnValue(unsubscribe)
    vi.mocked(telegramGateway.scheduled.getScheduledMessages).mockResolvedValue([
      makeScheduledMessage(1, groupChat.id, 'Follow up'),
    ])

    const messages = await scheduledService.getScheduledMessagesForChat(groupChat.id)

    expect(createFloodWaitSubscription).toHaveBeenCalledWith(
      telegramGateway.auth,
      {},
      expect.any(AbortSignal),
    )
    expect(telegramGateway.scheduled.getScheduledMessages).toHaveBeenCalledWith(groupChat.id)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.text).toBe('Follow up')
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('scans eligible dialogs and annotates scheduled messages with chat titles', async () => {
    const unsubscribe = vi.fn()
    createFloodWaitSubscription.mockReturnValue(unsubscribe)
    vi.mocked(telegramGateway.dialogs.getDialogs).mockResolvedValue([
      groupChat,
      adminChannel,
      memberChannel,
    ])
    vi.mocked(telegramGateway.scheduled.getScheduledMessages).mockImplementation(async (chatId) => {
      if (chatId === groupChat.id) {
        return [makeScheduledMessage(1, groupChat.id, 'Group reminder')]
      }

      if (chatId === adminChannel.id) {
        return []
      }

      return [makeScheduledMessage(2, memberChannel.id, 'Should not load')]
    })

    const progressUpdates: Array<{
      phase: string
      totalChats: number
      processedChats: number
      totalMessages: number
      currentChat?: string
    }> = []

    const result = await scheduledService.getAllScheduledMessages(
      {
        onProgress: (progress) => {
          progressUpdates.push({
            phase: progress.phase,
            totalChats: progress.totalChats,
            processedChats: progress.processedChats,
            totalMessages: progress.totalMessages,
            currentChat: progress.currentChat,
          })
        },
      },
      { chatLimit: 25 },
    )

    expect(createFloodWaitSubscription).toHaveBeenCalledWith(
      telegramGateway.auth,
      { onProgress: expect.any(Function) },
      expect.any(AbortSignal),
    )
    expect(telegramGateway.dialogs.getDialogs).toHaveBeenCalledWith(25)
    expect(withRetry).toHaveBeenCalledTimes(2)
    expect(telegramGateway.scheduled.getScheduledMessages).toHaveBeenCalledWith(groupChat.id)
    expect(telegramGateway.scheduled.getScheduledMessages).toHaveBeenCalledWith(adminChannel.id)
    expect(telegramGateway.scheduled.getScheduledMessages).not.toHaveBeenCalledWith(memberChannel.id)
    expect(result).toEqual([
      {
        chat: groupChat,
        messages: [
          expect.objectContaining({
            id: 1,
            chatId: groupChat.id,
            chatTitle: groupChat.title,
            text: 'Group reminder',
          }),
        ],
      },
    ])
    expect(progressUpdates[0]).toMatchObject({
      phase: 'loading_chats',
      totalChats: 0,
      processedChats: 0,
      totalMessages: 0,
    })
    expect(progressUpdates.at(-1)).toMatchObject({
      phase: 'complete',
      totalChats: 2,
      processedChats: 2,
      totalMessages: 1,
    })
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('forwards deletions and formatting helpers', async () => {
    await scheduledService.deleteScheduledMessages(groupChat.id, [1, 2])

    expect(telegramGateway.scheduled.deleteScheduledMessages).toHaveBeenCalledWith(groupChat.id, [
      1,
      2,
    ])
    expect(scheduledService.formatScheduledDate(new Date('2024-03-10T13:00:00Z'))).toBe(
      'in 1 hour',
    )
    expect(formatRelativeTimeFromNow).toHaveBeenCalledTimes(1)
  })
})
