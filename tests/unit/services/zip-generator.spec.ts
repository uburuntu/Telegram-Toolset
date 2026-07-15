import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import type { BackupWithMessages, DeletedMessage } from '@/types'
import { zipGenerator } from '@/services/export/zip-generator'

const emptyMediaTypes = {
  photos: 0,
  videos: 0,
  documents: 0,
  stickers: 0,
  voiceMessages: 0,
  videoNotes: 0,
  audio: 0,
  gifs: 0,
  polls: 0,
  locations: 0,
  contacts: 0,
}

function createMessage(overrides: Partial<DeletedMessage> = {}): DeletedMessage {
  return {
    id: 1,
    chatId: BigInt('1001234567890'),
    senderId: BigInt(1),
    senderName: 'Alice',
    text: 'hello',
    date: new Date('2024-03-10T12:00:00Z'),
    hasMedia: true,
    mediaType: 'document',
    mediaFilename: 'report.pdf',
    mediaMimeType: 'application/pdf',
    ...overrides,
  }
}

function createBackup(
  messages: DeletedMessage[],
  mediaBlobs: Map<number, Blob>,
): BackupWithMessages {
  return {
    id: 'backup-1',
    chatId: BigInt('1001234567890'),
    chatTitle: 'Test Chat',
    chatType: 'supergroup',
    createdAt: new Date('2024-03-10T12:00:00Z'),
    messageCount: messages.length,
    mediaCount: mediaBlobs.size,
    storageSize: 0,
    hasMedia: mediaBlobs.size > 0,
    mediaTypes: emptyMediaTypes,
    exportMode: 'all',
    messages,
    mediaBlobs,
  }
}

async function generateDownloadedZip(backup: BackupWithMessages): Promise<Blob> {
  let capturedBlob: Blob | null = null
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      capturedBlob = blob
      return 'blob:test-download'
    }),
  })

  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })

  try {
    await zipGenerator.generateAndDownload(backup)
  } finally {
    if (createObjectUrlDescriptor) {
      Object.defineProperty(URL, 'createObjectURL', createObjectUrlDescriptor)
    } else {
      delete (URL as { createObjectURL?: (object: Blob | MediaSource) => string }).createObjectURL
    }

    if (revokeObjectUrlDescriptor) {
      Object.defineProperty(URL, 'revokeObjectURL', revokeObjectUrlDescriptor)
    } else {
      delete (URL as { revokeObjectURL?: (url: string) => void }).revokeObjectURL
    }

    clickSpy.mockRestore()
  }

  expect(capturedBlob).toBeInstanceOf(Blob)
  return capturedBlob as Blob
}

describe('zipGenerator', () => {
  it('sanitizes Telegram-provided media filenames before adding them to downloaded archives', async () => {
    const backup = createBackup(
      [
        createMessage({
          id: 11,
          mediaFilename: '../../quarterly report:\u0000?.pdf',
        }),
      ],
      new Map([[11, new Blob(['report'], { type: 'application/pdf' })]]),
    )

    const blob = await generateDownloadedZip(backup)
    const zip = await JSZip.loadAsync(blob)
    const archiveEntries = Object.keys(zip.files)

    expect(archiveEntries).toEqual(
      expect.arrayContaining(['media/', 'media/11_.._.._quarterly_report___.pdf']),
    )
    expect(archiveEntries.some((entry) => entry.includes('../') || entry.includes('..\\'))).toBe(
      false,
    )
  })

  it('falls back to message-id filenames when sanitization removes the Telegram name', async () => {
    const backup = createBackup(
      [
        createMessage({
          id: 12,
          mediaFilename: '..',
          mediaMimeType: 'image/png',
        }),
        createMessage({
          id: 13,
          mediaFilename: '<>:"/\\\\|?*\u0000',
        }),
      ],
      new Map([
        [12, new Blob(['image'], { type: 'image/png' })],
        [13, new Blob(['document'], { type: 'application/pdf' })],
      ]),
    )

    const blob = await generateDownloadedZip(backup)
    const zip = await JSZip.loadAsync(blob)
    const archiveEntries = Object.keys(zip.files)

    expect(archiveEntries).toEqual(expect.arrayContaining(['media/12.png', 'media/13.pdf']))
  })

  it('keeps generateBlob media entry naming on the existing message-id path', async () => {
    const backup = createBackup(
      [
        createMessage({
          id: 21,
          mediaFilename: '../../raw report.pdf',
        }),
      ],
      new Map([[21, new Blob(['report'], { type: 'application/pdf' })]]),
    )

    const blob = await zipGenerator.generateBlob(backup)
    const zip = await JSZip.loadAsync(blob)
    const archiveEntries = Object.keys(zip.files)

    expect(archiveEntries).toEqual(expect.arrayContaining(['media/21.pdf']))
    expect(archiveEntries).not.toContain('media/.._.._raw_report.pdf')
  })

  it('keeps media files distinct when Telegram filenames collide', async () => {
    const backup = createBackup(
      [
        createMessage({ id: 31, mediaFilename: 'report?.pdf' }),
        createMessage({ id: 32, mediaFilename: 'report*.pdf' }),
      ],
      new Map([
        [31, new Blob(['first'], { type: 'application/pdf' })],
        [32, new Blob(['second'], { type: 'application/pdf' })],
      ]),
    )

    const blob = await generateDownloadedZip(backup)
    const zip = await JSZip.loadAsync(blob)

    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(['media/31_report_.pdf', 'media/32_report_.pdf']),
    )
    await expect(zip.file('media/31_report_.pdf')?.async('text')).resolves.toBe('first')
    await expect(zip.file('media/32_report_.pdf')?.async('text')).resolves.toBe('second')
  })
})
