import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatExport, ChatMessage, FormatConfig } from '@/types'

vi.mock('@/services/telegram/gateway', () => ({
  telegramGateway: {
    media: {
      getChatMessagesByIds: vi.fn(),
      downloadMedia: vi.fn(),
    },
  },
}))

import { chatArchiveService } from '@/services/llm-export/archive-service'
import { telegramGateway } from '@/services/telegram/gateway'

const chatExport: ChatExport = {
  id: 'export-1',
  chatId: BigInt('1234567890'),
  chatPeerId: '-1001234567890',
  chatTitle: 'Test Chat',
  chatType: 'supergroup',
  schemaVersion: 2,
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
    chatPeerId: chatExport.chatPeerId,
    senderId: BigInt('101'),
    senderPeerId: '101',
    senderName: 'Alice',
    text: 'Hello',
    date: new Date('2024-03-10T10:00:00Z'),
    hasMedia: false,
  },
  {
    id: 2,
    chatId: chatExport.chatId,
    chatPeerId: chatExport.chatPeerId,
    senderId: BigInt('202'),
    senderPeerId: '202',
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
    chatPeerId: chatExport.chatPeerId,
    senderId: BigInt('303'),
    senderPeerId: '303',
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

    vi.mocked(telegramGateway.media.getChatMessagesByIds).mockImplementation(
      async (_chatId, ids) => {
        return new Map(ids.map((id) => [id, { id, media: true }]))
      },
    )

    vi.mocked(telegramGateway.media.downloadMedia).mockImplementation(async (rawMessage) => {
      const id = Number((rawMessage as { id: number }).id)
      const mimeType = id === 2 ? 'image/jpeg' : 'application/pdf'
      return new Blob([`media-${id}`], { type: mimeType })
    })
  })

  it('builds a ZIP with formatted output, canonical messages.json, and media files', async () => {
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

    const metadata = JSON.parse(await zip.file('metadata.json')!.async('string'))
    expect(metadata.includedMediaFiles).toBe(2)
    expect(metadata.failedMediaFiles).toBe(0)

    const document = JSON.parse(await zip.file('messages.json')!.async('string'))
    expect(document.schemaVersion).toBe(1)
    expect(document.chat.peerId).toBe('-1001234567890')
    expect(document.messages).toHaveLength(3)
    expect(document.messages[1].media.archivePath).toBe('media/2_photo_2.jpg')
    expect(document.messages[2].media.archivePath).toBe('media/3_report.pdf')

    expect(telegramGateway.media.getChatMessagesByIds).toHaveBeenCalledWith(
      chatExport.chatPeerId,
      [2, 3],
    )
    expect(telegramGateway.media.downloadMedia).toHaveBeenCalledTimes(2)
  })

  it('only downloads media for the selected message subset', async () => {
    const blob = await chatArchiveService.generateBlob(chatExport, messages, {
      ...baseConfig,
      reverseOrder: false,
      messageLimit: 1,
    })
    const zip = await JSZip.loadAsync(blob)
    const document = JSON.parse(await zip.file('messages.json')!.async('string'))

    expect(document.messages).toHaveLength(1)
    expect(document.messages[0].id).toBe(3)
    expect(telegramGateway.media.getChatMessagesByIds).toHaveBeenCalledWith(
      chatExport.chatPeerId,
      [3],
    )
    expect(telegramGateway.media.downloadMedia).toHaveBeenCalledTimes(1)
  })

  it('keeps building the archive when one media file cannot be reloaded', async () => {
    vi.mocked(telegramGateway.media.getChatMessagesByIds).mockResolvedValue(
      new Map([[2, { id: 2, media: true }]]),
    )

    const result = await chatArchiveService.generateArchive(chatExport, messages, baseConfig)
    const zip = await JSZip.loadAsync(result.blob)
    const metadata = JSON.parse(await zip.file('metadata.json')!.async('string'))
    const document = JSON.parse(await zip.file('messages.json')!.async('string'))

    expect(result.mediaFailures).toHaveLength(1)
    expect(metadata.failedMediaFiles).toBe(1)
    expect(document.messages[1].media.archivePath).toBe('media/2_photo_2.jpg')
    expect(document.messages[2].media.archivePath).toBeUndefined()
  })
})
