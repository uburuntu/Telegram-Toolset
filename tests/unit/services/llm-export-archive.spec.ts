import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatExport, ChatMessage, FormatConfig } from '@/types'

vi.mock('@/services/telegram/client', () => ({
  telegramService: {
    getChatMessagesByIds: vi.fn(),
    downloadMedia: vi.fn(),
  },
}))

import { chatArchiveService } from '@/services/llm-export/archive-service'
import { telegramService } from '@/services/telegram/client'

const chatExport: ChatExport = {
  id: 'export-1',
  chatId: BigInt('-1001234567890'),
  chatTitle: 'Test Chat',
  chatType: 'supergroup',
  createdAt: new Date('2024-03-10T12:00:00Z'),
  messageCount: 3,
  hasMedia: true,
  mediaCount: 2,
  dateRange: {
    from: new Date('2024-03-10T10:00:00Z'),
    to: new Date('2024-03-10T12:00:00Z'),
  },
}

const messages: ChatMessage[] = [
  {
    id: 1,
    chatId: chatExport.chatId,
    senderId: BigInt('101'),
    senderName: 'Alice',
    text: 'Hello',
    date: new Date('2024-03-10T10:00:00Z'),
    hasMedia: false,
  },
  {
    id: 2,
    chatId: chatExport.chatId,
    senderId: BigInt('202'),
    senderName: 'Bob',
    text: 'See photo',
    date: new Date('2024-03-10T11:00:00Z'),
    hasMedia: true,
    mediaType: 'photo',
    mediaFilename: 'photo_2.jpg',
    mediaMimeType: 'image/jpeg',
  },
  {
    id: 3,
    chatId: chatExport.chatId,
    senderId: BigInt('303'),
    senderName: 'Carol',
    text: 'Quarterly report',
    date: new Date('2024-03-10T12:00:00Z'),
    hasMedia: true,
    mediaType: 'document',
    mediaFilename: 'report.pdf',
    mediaMimeType: 'application/pdf',
  },
]

const baseConfig: FormatConfig = {
  template: 'plain',
  includeDate: true,
  dateFormat: 'short',
  dateGrouping: 'per-message',
  includeSenderName: true,
  includeSenderUsername: false,
  useOriginalSenderNames: false,
  includeReplyContext: true,
  includeMessageIds: false,
  mediaPlaceholder: 'bracket',
  messageLimit: 0,
  reverseOrder: true,
}

describe('ChatArchiveService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(telegramService.getChatMessagesByIds).mockImplementation(async (_chatId, ids) => {
      return new Map(ids.map((id) => [id, { id, media: true }]))
    })

    vi.mocked(telegramService.downloadMedia).mockImplementation(async (rawMessage) => {
      const id = Number((rawMessage as { id: number }).id)
      const mimeType = id === 2 ? 'image/jpeg' : 'application/pdf'
      return new Blob([`media-${id}`], { type: mimeType })
    })
  })

  it('builds a ZIP with formatted output, manifest, and media files', async () => {
    const blob = await chatArchiveService.generateBlob(chatExport, messages, baseConfig)
    const zip = await JSZip.loadAsync(blob)

    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining([
        'context.txt',
        'metadata.json',
        'messages.json',
        'media/',
        'media/2_photo_2.jpg',
        'media/3_report.pdf',
      ]),
    )

    const context = await zip.file('context.txt')!.async('string')
    expect(context).toContain('Alice')
    expect(context).toContain('[photo]')

    const metadata = JSON.parse(await zip.file('metadata.json')!.async('string'))
    expect(metadata.formattedFile).toBe('context.txt')
    expect(metadata.includedMediaFiles).toBe(2)
    expect(metadata.failedMediaFiles).toBe(0)

    const manifest = JSON.parse(await zip.file('messages.json')!.async('string'))
    expect(manifest).toHaveLength(3)
    expect(manifest[1].media.path).toBe('media/2_photo_2.jpg')
    expect(manifest[2].media.path).toBe('media/3_report.pdf')

    expect(telegramService.getChatMessagesByIds).toHaveBeenCalledWith(chatExport.chatId, [2, 3])
    expect(telegramService.downloadMedia).toHaveBeenCalledTimes(2)
  })

  it('only downloads media for the currently selected message subset', async () => {
    const blob = await chatArchiveService.generateBlob(chatExport, messages, {
      ...baseConfig,
      reverseOrder: false,
      messageLimit: 1,
    })
    const zip = await JSZip.loadAsync(blob)
    const manifest = JSON.parse(await zip.file('messages.json')!.async('string'))

    expect(manifest).toHaveLength(1)
    expect(manifest[0].id).toBe(3)
    expect(telegramService.getChatMessagesByIds).toHaveBeenCalledWith(chatExport.chatId, [3])
    expect(telegramService.downloadMedia).toHaveBeenCalledTimes(1)
  })

  it('keeps building the archive when one media file cannot be reloaded', async () => {
    vi.mocked(telegramService.getChatMessagesByIds).mockResolvedValue(
      new Map([[2, { id: 2, media: true }]]),
    )

    const blob = await chatArchiveService.generateBlob(chatExport, messages, baseConfig)
    const zip = await JSZip.loadAsync(blob)
    const metadata = JSON.parse(await zip.file('metadata.json')!.async('string'))
    const manifest = JSON.parse(await zip.file('messages.json')!.async('string'))

    expect(metadata.includedMediaFiles).toBe(1)
    expect(metadata.failedMediaFiles).toBe(1)
    expect(manifest[1].media.path).toBe('media/2_photo_2.jpg')
    expect(manifest[2].media.path).toBeUndefined()
  })
})
