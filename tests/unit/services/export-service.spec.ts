import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DeletedMessage, ExportConfig } from '@/types'

// Mock telegramGateway before importing exportService
const mockDeletedMessages: DeletedMessage[] = [
  {
    id: 1001,
    chatId: BigInt('1234567890'),
    senderId: BigInt('999888777'),
    text: 'First deleted message',
    date: new Date('2024-01-15T10:30:00'),
    hasMedia: false,
  },
  {
    id: 1002,
    chatId: BigInt('1234567890'),
    senderId: BigInt('999888778'),
    text: 'Message with photo',
    date: new Date('2024-01-15T10:35:00'),
    hasMedia: true,
    mediaType: 'photo',
    mediaFilename: 'photo_1002.jpg',
    mediaSize: 102400,
  },
  {
    id: 1003,
    chatId: BigInt('1234567890'),
    senderId: BigInt('999888779'),
    text: 'Video message',
    date: new Date('2024-01-15T10:40:00'),
    hasMedia: true,
    mediaType: 'video',
    mediaFilename: 'video_1003.mp4',
    mediaSize: 5242880,
  },
]

vi.mock('@/services/telegram/gateway', () => ({
  telegramGateway: {
    adminLog: {
      iterDeletedMessages: vi.fn(async function* () {
        for (const msg of mockDeletedMessages) {
          yield msg
        }
      }),
      validateChatForExport: vi.fn().mockResolvedValue({
        valid: true,
        canExport: true,
        chatType: 'channel',
        chatTitle: 'Test Channel',
      }),
    },
    entities: {
      resolveSenderInfo: vi.fn().mockResolvedValue({
        name: 'Resolved Name',
        username: 'resolveduser',
      }),
    },
    media: {
      downloadMessageMedia: vi
        .fn()
        .mockResolvedValue(new Blob(['fake media'], { type: 'image/jpeg' })),
    },
  },
}))

// Import after mocking
import { exportService } from '@/services/export/export-service'
import { telegramGateway } from '@/services/telegram/gateway'

describe('ExportService', () => {
  const baseConfig: ExportConfig = {
    chatId: BigInt('1234567890'),
    chatTitle: 'Test Channel',
    exportMode: 'all',
    storageStrategy: 'indexeddb',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    
    // Reset to default mock implementations
    vi.mocked(telegramGateway.adminLog.iterDeletedMessages).mockImplementation(async function* () {
      for (const msg of mockDeletedMessages) {
        yield msg
      }
    })
    
    vi.mocked(telegramGateway.entities.resolveSenderInfo).mockResolvedValue({
      name: 'Resolved Name',
      username: 'resolveduser',
    })
    
    vi.mocked(telegramGateway.media.downloadMessageMedia).mockResolvedValue(
      new Blob(['fake media'], { type: 'image/jpeg' })
    )
    
    vi.mocked(telegramGateway.adminLog.validateChatForExport).mockResolvedValue({
      valid: true,
      canExport: true,
      chatType: 'channel',
      chatTitle: 'Test Channel',
    })
  })

  afterEach(() => {
    exportService.cancel()
  })

  describe('exportDeletedMessages', () => {
    it('should export all messages from admin log', async () => {
      const result = await exportService.exportDeletedMessages(baseConfig)

      expect(result.messages.length).toBe(3)
      // iterDeletedMessages is now called with chatId and options object
      expect(telegramGateway.adminLog.iterDeletedMessages).toHaveBeenCalledWith(
        baseConfig.chatId,
        {},
      )
    })

    it('should enrich messages with sender info', async () => {
      const result = await exportService.exportDeletedMessages(baseConfig)

      // All messages should have resolved sender info
      for (const msg of result.messages) {
        expect(msg.senderName).toBe('Resolved Name')
        expect(msg.senderUsername).toBe('resolveduser')
      }
    })

    it('should download media for messages with media', async () => {
      const result = await exportService.exportDeletedMessages(baseConfig)

      // 2 messages have media
      expect(telegramGateway.media.downloadMessageMedia).toHaveBeenCalledTimes(2)
      expect(result.mediaBlobs.size).toBe(2)
      expect(result.mediaBlobs.has(1002)).toBe(true)
      expect(result.mediaBlobs.has(1003)).toBe(true)
    })

    it('should skip media download in text_only mode', async () => {
      const result = await exportService.exportDeletedMessages({
        ...baseConfig,
        exportMode: 'text_only',
      })

      expect(telegramGateway.media.downloadMessageMedia).not.toHaveBeenCalled()
      expect(result.mediaBlobs.size).toBe(0)
      // Still should have all messages
      expect(result.messages.length).toBe(3)
    })

    it('should exclude text-only messages in media_only mode', async () => {
      const result = await exportService.exportDeletedMessages({
        ...baseConfig,
        exportMode: 'media_only',
      })

      expect(result.messages.map((message) => message.id)).toEqual([1002, 1003])
      expect(result.messages.every((message) => message.hasMedia)).toBe(true)
      expect(result.progress.exportedTextMessages).toBe(2)
      expect(telegramGateway.media.downloadMessageMedia).toHaveBeenCalledTimes(2)
    })

    it('should track progress through phases', async () => {
      const phases: string[] = []

      await exportService.exportDeletedMessages(baseConfig, {
        onProgress: (progress) => {
          if (!phases.includes(progress.phase)) {
            phases.push(progress.phase)
          }
        },
      })

      expect(phases).toContain('fetching_metadata')
      expect(phases).toContain('downloading_media')
      expect(phases).toContain('complete')
    })

    it('should count text and media messages separately', async () => {
      let finalProgress: (typeof baseConfig & { phase: string }) | null = null

      await exportService.exportDeletedMessages(baseConfig, {
        onProgress: (progress) => {
          finalProgress = progress as typeof finalProgress
        },
      })

      expect(finalProgress).not.toBeNull()
      // All 3 messages have text
      expect(finalProgress!.exportedTextMessages).toBe(3)
      // 2 messages have media
      expect(finalProgress!.exportedMediaMessages).toBe(2)
    })
  })

  describe('cancellation', () => {
    it('should support cancellation during metadata phase', async () => {
      let messageCount = 0

      vi.mocked(telegramGateway.adminLog.iterDeletedMessages).mockImplementation(async function* () {
        for (const msg of mockDeletedMessages) {
          messageCount++
          if (messageCount === 2) {
            // Cancel after 2 messages
            exportService.cancel()
          }
          yield msg
        }
      })

      // Should throw a DOMException with name 'AbortError'
      try {
        await exportService.exportDeletedMessages(baseConfig)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DOMException)
        expect((error as DOMException).name).toBe('AbortError')
      }
    })

    it('should report cancelled status', async () => {
      let finalPhase = ''

      vi.mocked(telegramGateway.adminLog.iterDeletedMessages).mockImplementation(async function* () {
        exportService.cancel()
        yield mockDeletedMessages[0]
      })

      try {
        await exportService.exportDeletedMessages(baseConfig, {
          onProgress: (progress) => {
            finalPhase = progress.phase
          },
        })
      } catch {
        // Expected
      }

      expect(finalPhase).toBe('cancelled')
    })

    it('should track isExporting state', async () => {
      // Not exporting initially
      expect(exportService.isExporting).toBe(false)

      let wasExporting = false

      vi.mocked(telegramGateway.adminLog.iterDeletedMessages).mockImplementation(async function* () {
        wasExporting = exportService.isExporting
        yield mockDeletedMessages[0]
      })

      await exportService.exportDeletedMessages(baseConfig)

      expect(wasExporting).toBe(true)
      expect(exportService.isExporting).toBe(false)
    })

    it('should remain busy until a cancelled export settles', async () => {
      let resolveValidation!: (value: {
        valid: boolean
        canExport: boolean
        chatType: 'channel'
        chatTitle: string
      }) => void
      const validation = new Promise<{
        valid: boolean
        canExport: boolean
        chatType: 'channel'
        chatTitle: string
      }>((resolve) => {
        resolveValidation = resolve
      })
      vi.mocked(telegramGateway.adminLog.validateChatForExport).mockReturnValueOnce(validation)

      const exportPromise = exportService.exportDeletedMessages(baseConfig)
      exportService.cancel()

      expect(exportService.isExporting).toBe(true)
      await expect(exportService.exportDeletedMessages(baseConfig)).rejects.toThrow(
        'An export is already in progress',
      )

      resolveValidation({
        valid: true,
        canExport: true,
        chatType: 'channel',
        chatTitle: 'Test Channel',
      })

      await expect(exportPromise).rejects.toMatchObject({ name: 'AbortError' })
      expect(exportService.isExporting).toBe(false)
    })
  })

  describe('error handling', () => {
    it('should handle sender resolution failures gracefully', async () => {
      vi.mocked(telegramGateway.entities.resolveSenderInfo).mockRejectedValue(
        new Error('Entity not found'),
      )

      const result = await exportService.exportDeletedMessages(baseConfig)

      // Should still export all messages, just without enriched sender info
      expect(result.messages.length).toBe(3)
    })

    it('should handle individual media download failures', async () => {
      const errors: Error[] = []

      // Reject ALL download attempts to ensure we get consistent failures
      vi.mocked(telegramGateway.media.downloadMessageMedia).mockRejectedValue(
        new Error('Download failed'),
      )

      const result = await exportService.exportDeletedMessages(baseConfig, {
        onError: (error) => {
          errors.push(error)
        },
      })

      // Both media downloads should fail (ids 1002 and 1003)
      expect(errors.length).toBe(2)
      expect(result.mediaBlobs.size).toBe(0)
      expect(result.progress.failedMessages).toBe(2)
    })

    it('should report error phase on critical failure', async () => {
      vi.mocked(telegramGateway.adminLog.iterDeletedMessages).mockImplementation(async function* () {
        throw new Error('Connection lost')
      })

      let finalPhase = ''
      let errorMessage = ''

      try {
        await exportService.exportDeletedMessages(baseConfig, {
          onProgress: (progress) => {
            finalPhase = progress.phase
            if (progress.errorMessage) {
              errorMessage = progress.errorMessage
            }
          },
        })
      } catch {
        // Expected
      }

      expect(finalPhase).toBe('error')
      expect(errorMessage).toContain('Connection lost')
    })
  })

  describe('estimateExportSize', () => {
    it('should calculate size from messages and blobs', () => {
      // Use messages without BigInt for JSON serialization compatibility
      // In production, a custom serializer would handle BigInt
      const messages = [
        { id: 1, text: 'Hello', date: new Date(), hasMedia: false },
        { id: 2, text: 'World', date: new Date(), hasMedia: true },
      ] as unknown as DeletedMessage[]

      const mediaBlobs = new Map<number, Blob>()
      mediaBlobs.set(2, new Blob(['x'.repeat(1000)])) // 1000 byte blob

      const size = exportService.estimateExportSize(messages, mediaBlobs)

      // JSON metadata + blob size
      expect(size).toBeGreaterThan(1000)
    })

    it('should return small size for empty export', () => {
      const size = exportService.estimateExportSize([], new Map())

      // Just empty array JSON
      expect(size).toBe(2) // "[]"
    })
  })
})
