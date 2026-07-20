import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DeletedMessage, ResendConfig } from '@/types'

// We need to mock telegramGateway before importing resendService
vi.mock('@/services/telegram/gateway', () => ({
  telegramGateway: {
    send: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendFile: vi.fn().mockResolvedValue(undefined),
    },
  },
}))

// Import after mocking
import { resendService } from '@/services/resend/resend-service'
import { telegramGateway } from '@/services/telegram/gateway'

describe('ResendService', () => {
  const baseConfig: ResendConfig = {
    targetChatId: BigInt('123456'),
    targetChatTitle: 'Test Chat',
    backupId: 'test-backup',
    includeText: true,
    includeMedia: true,
    showSenderName: true,
    showSenderUsername: true,
    showDate: true,
    showReplyLink: false,
    useHiddenReplyLinks: false,
    timezone: 'UTC',
    enableBatching: false,
    batchMaxMessages: 5,
    batchMaxMessageLength: 200,
    batchTimeWindowMinutes: 5,
  }

  const createMessage = (overrides: Partial<DeletedMessage> = {}): DeletedMessage => ({
    id: 1,
    chatId: BigInt('1234567890'),
    senderId: BigInt('999888777'),
    senderName: 'Alice',
    senderUsername: 'alice',
    text: 'Hello, world!',
    date: new Date('2024-01-15T10:30:00Z'),
    hasMedia: false,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    resendService.cancel() // Ensure cleanup
  })

  describe('resendMessages', () => {
    it('should send a single text message', async () => {
      const messages = [createMessage()]
      const mediaBlobs = new Map<number, Blob>()

      const result = await resendService.resendMessages(messages, mediaBlobs, baseConfig)

      expect(telegramGateway.send.sendMessage).toHaveBeenCalledTimes(1)
      expect(result.sentCount).toBe(1)
      expect(result.failedCount).toBe(0)
    })

    it('should skip messages when includeText is false and no media', async () => {
      const messages = [createMessage()]
      const mediaBlobs = new Map<number, Blob>()
      const config = { ...baseConfig, includeText: false }

      const result = await resendService.resendMessages(messages, mediaBlobs, config)

      expect(telegramGateway.send.sendMessage).not.toHaveBeenCalled()
      expect(result.sentCount).toBe(0)
    })

    it('should send media with caption', async () => {
      const messages = [createMessage({ hasMedia: true, mediaFilename: 'photo.jpg' })]
      const blob = new Blob(['fake image'], { type: 'image/jpeg' })
      const mediaBlobs = new Map<number, Blob>([[1, blob]])

      const result = await resendService.resendMessages(messages, mediaBlobs, baseConfig)

      expect(telegramGateway.send.sendFile).toHaveBeenCalledTimes(1)
      expect(telegramGateway.send.sendFile).toHaveBeenCalledWith(
        baseConfig.targetChatId,
        blob,
        expect.objectContaining({
          caption: expect.any(String),
          parseMode: 'html',
          filename: 'photo.jpg',
        })
      )
      expect(result.sentCount).toBe(1)
    })

    it('should send text but count a failure when media blob is missing', async () => {
      const messages = [createMessage({ hasMedia: true, text: 'Caption text' })]
      const mediaBlobs = new Map<number, Blob>() // No blob for this message

      const result = await resendService.resendMessages(messages, mediaBlobs, baseConfig)

      expect(telegramGateway.send.sendFile).not.toHaveBeenCalled()
      expect(telegramGateway.send.sendMessage).toHaveBeenCalledTimes(1)
      expect(result.sentCount).toBe(1)
      expect(result.failedCount).toBe(1)
    })

    it('should fail media-only messages when media blob is missing', async () => {
      const messages = [createMessage({ hasMedia: true, text: '', mediaFilename: 'photo.jpg' })]
      const mediaBlobs = new Map<number, Blob>()

      const result = await resendService.resendMessages(messages, mediaBlobs, baseConfig)

      expect(telegramGateway.send.sendFile).not.toHaveBeenCalled()
      expect(telegramGateway.send.sendMessage).not.toHaveBeenCalled()
      expect(result.sentCount).toBe(0)
      expect(result.failedCount).toBe(1)
    })

    it('should sort messages by date (oldest first)', async () => {
      const sentTexts: string[] = []
      vi.mocked(telegramGateway.send.sendMessage).mockImplementation(async (_chatId, text) => {
        sentTexts.push(text)
      })

      const messages = [
        createMessage({ id: 1, text: 'Second', date: new Date('2024-01-15T12:00:00Z') }),
        createMessage({ id: 2, text: 'First', date: new Date('2024-01-15T10:00:00Z') }),
        createMessage({ id: 3, text: 'Third', date: new Date('2024-01-15T14:00:00Z') }),
      ]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, baseConfig)

      expect(sentTexts[0]).toContain('First')
      expect(sentTexts[1]).toContain('Second')
      expect(sentTexts[2]).toContain('Third')
    })
  })

  describe('message batching', () => {
    it('should not batch when batching disabled', async () => {
      const messages = [
        createMessage({ id: 1, text: 'One' }),
        createMessage({ id: 2, text: 'Two' }),
      ]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, {
        ...baseConfig,
        enableBatching: false,
      })

      // Each message sent separately
      expect(telegramGateway.send.sendMessage).toHaveBeenCalledTimes(2)
    })

    it('should batch consecutive messages from same sender', async () => {
      const senderId = BigInt('999888777')
      const messages = [
        createMessage({
          id: 1,
          text: 'One',
          senderId,
          date: new Date('2024-01-15T10:00:00Z'),
        }),
        createMessage({
          id: 2,
          text: 'Two',
          senderId,
          date: new Date('2024-01-15T10:01:00Z'),
        }),
      ]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, {
        ...baseConfig,
        enableBatching: true,
        batchTimeWindowMinutes: 5,
      })

      // Both messages combined into one send
      expect(telegramGateway.send.sendMessage).toHaveBeenCalledTimes(1)
      const sentText = vi.mocked(telegramGateway.send.sendMessage).mock.calls[0][1]
      expect(sentText).toContain('One')
      expect(sentText).toContain('Two')
    })

    it('should not batch messages from different senders', async () => {
      const messages = [
        createMessage({
          id: 1,
          text: 'From Alice',
          senderId: BigInt('111'),
          date: new Date('2024-01-15T10:00:00Z'),
        }),
        createMessage({
          id: 2,
          text: 'From Bob',
          senderId: BigInt('222'),
          date: new Date('2024-01-15T10:01:00Z'),
        }),
      ]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, {
        ...baseConfig,
        enableBatching: true,
      })

      expect(telegramGateway.send.sendMessage).toHaveBeenCalledTimes(2)
    })

    it('should not batch messages with media', async () => {
      const senderId = BigInt('999888777')
      const messages = [
        createMessage({
          id: 1,
          text: 'Text',
          senderId,
          date: new Date('2024-01-15T10:00:00Z'),
        }),
        createMessage({
          id: 2,
          text: 'With media',
          senderId,
          hasMedia: true,
          date: new Date('2024-01-15T10:01:00Z'),
        }),
      ]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, {
        ...baseConfig,
        enableBatching: true,
      })

      // First one sends alone, second one (with media) sends alone
      expect(telegramGateway.send.sendMessage).toHaveBeenCalledTimes(2)
    })

    it('should not batch messages outside time window', async () => {
      const senderId = BigInt('999888777')
      const messages = [
        createMessage({
          id: 1,
          text: 'First',
          senderId,
          date: new Date('2024-01-15T10:00:00Z'),
        }),
        createMessage({
          id: 2,
          text: 'Much later',
          senderId,
          date: new Date('2024-01-15T10:30:00Z'), // 30 minutes later
        }),
      ]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, {
        ...baseConfig,
        enableBatching: true,
        batchTimeWindowMinutes: 5,
      })

      expect(telegramGateway.send.sendMessage).toHaveBeenCalledTimes(2)
    })
  })

  describe('header formatting', () => {
    it('should include sender name when showSenderName is true', async () => {
      const messages = [createMessage({ senderName: 'TestUser' })]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, {
        ...baseConfig,
        showSenderName: true,
        showSenderUsername: false,
        showDate: false,
      })

      const sentText = vi.mocked(telegramGateway.send.sendMessage).mock.calls[0][1]
      expect(sentText).toContain('TestUser')
    })

    it('should include username when showSenderUsername is true', async () => {
      const messages = [createMessage({ senderUsername: 'testhandle' })]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, {
        ...baseConfig,
        showSenderName: false,
        showSenderUsername: true,
        showDate: false,
      })

      const sentText = vi.mocked(telegramGateway.send.sendMessage).mock.calls[0][1]
      expect(sentText).toContain('@testhandle')
    })

    it('should format date with timezone', async () => {
      const messages = [createMessage({ date: new Date('2024-01-15T10:30:00Z') })]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, {
        ...baseConfig,
        showSenderName: false,
        showSenderUsername: false,
        showDate: true,
        timezone: 'Europe/Moscow', // UTC+3
      })

      const sentText = vi.mocked(telegramGateway.send.sendMessage).mock.calls[0][1]
      expect(sentText).toContain('13:30') // 10:30 UTC = 13:30 Moscow
    })

    it('should include reply link when enabled', async () => {
      const messages = [
        createMessage({
          chatId: BigInt('1234567890'),
          replyToMsgId: 500,
        }),
      ]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, {
        ...baseConfig,
        showReplyLink: true,
        useHiddenReplyLinks: false,
      })

      const sentText = vi.mocked(telegramGateway.send.sendMessage).mock.calls[0][1]
      expect(sentText).toContain('t.me/c/')
      expect(sentText).toContain('500')
    })

    it('should use hidden reply links when enabled', async () => {
      const messages = [
        createMessage({
          chatId: BigInt('1234567890'),
          replyToMsgId: 500,
        }),
      ]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, {
        ...baseConfig,
        showReplyLink: true,
        useHiddenReplyLinks: true,
      })

      const sentText = vi.mocked(telegramGateway.send.sendMessage).mock.calls[0][1]
      expect(sentText).toContain('<a href=')
      expect(sentText).toContain('↩️ Reply')
    })

    it('should include quote text when present', async () => {
      const messages = [createMessage({ quoteText: 'This is quoted' })]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, baseConfig)

      const sentText = vi.mocked(telegramGateway.send.sendMessage).mock.calls[0][1]
      expect(sentText).toContain('❝ This is quoted ❞')
    })
  })

  describe('cancellation', () => {
    it('should stop sending when cancelled', async () => {
      let callCount = 0
      vi.mocked(telegramGateway.send.sendMessage).mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          // Cancel after first message
          resendService.cancel()
        }
      })

      const messages = [
        createMessage({ id: 1, text: 'One' }),
        createMessage({ id: 2, text: 'Two' }),
        createMessage({ id: 3, text: 'Three' }),
      ]
      const mediaBlobs = new Map<number, Blob>()

      // Should throw a DOMException with name 'AbortError'
      try {
        await resendService.resendMessages(messages, mediaBlobs, baseConfig)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DOMException)
        expect((error as DOMException).name).toBe('AbortError')
      }
    })

    it('waits for an in-flight send to settle before reporting idle', async () => {
      let releaseSend!: () => void
      vi.mocked(telegramGateway.send.sendMessage).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseSend = resolve
          }),
      )

      const resend = resendService.resendMessages(
        [createMessage()],
        new Map<number, Blob>(),
        baseConfig,
      )
      const resendResult = resend.catch((error: unknown) => error)
      await vi.waitFor(() => {
        expect(telegramGateway.send.sendMessage).toHaveBeenCalledTimes(1)
      })

      let finishedWaiting = false
      const waitForIdle = resendService.cancelAndWait().then(() => {
        finishedWaiting = true
      })
      await Promise.resolve()
      expect(finishedWaiting).toBe(false)

      releaseSend()
      await waitForIdle

      const error = await resendResult
      expect(error).toBeInstanceOf(DOMException)
      expect((error as DOMException).name).toBe('AbortError')
      expect(resendService.isResending).toBe(false)
    })

    it('abandons singleton ownership when cancellation cannot settle by its deadline', async () => {
      let releaseSend!: () => void
      vi.mocked(telegramGateway.send.sendMessage).mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseSend = resolve
          }),
      )

      const resend = resendService.resendMessages(
        [createMessage()],
        new Map<number, Blob>(),
        baseConfig,
      )
      const resendResult = resend.catch((error: unknown) => error)
      await vi.waitFor(() => {
        expect(telegramGateway.send.sendMessage).toHaveBeenCalledTimes(1)
      })

      await expect(resendService.cancelAndWait(5)).resolves.toBe(false)
      expect(resendService.isResending).toBe(false)

      releaseSend()
      const error = await resendResult
      expect(error).toBeInstanceOf(DOMException)
      expect((error as DOMException).name).toBe('AbortError')
    })
  })

  describe('progress tracking', () => {
    it('should report progress through callbacks', async () => {
      const progressUpdates: number[] = []

      const messages = [
        createMessage({ id: 1, text: 'One' }),
        createMessage({ id: 2, text: 'Two' }),
      ]
      const mediaBlobs = new Map<number, Blob>()

      await resendService.resendMessages(messages, mediaBlobs, baseConfig, {
        onProgress: (progress) => {
          progressUpdates.push(progress.processedMessages)
        },
      })

      // Should have progress updates
      expect(progressUpdates.length).toBeGreaterThan(0)
      // Final update should show all processed
      expect(progressUpdates[progressUpdates.length - 1]).toBe(2)
    })

    it('should report errors through callbacks', async () => {
      // Reject all retries to trigger error callback
      vi.mocked(telegramGateway.send.sendMessage).mockRejectedValue(new Error('Send failed'))

      const errors: Error[] = []
      const messages = [createMessage()]
      const mediaBlobs = new Map<number, Blob>()

      const result = await resendService.resendMessages(messages, mediaBlobs, baseConfig, {
        onError: (error) => {
          errors.push(error)
        },
      })

      expect(errors.length).toBe(1)
      expect(errors[0].message).toBe('Send failed')
      expect(result.failedCount).toBe(1)
    })
  })
})
