/**
 * Archive generation for LLM exports.
 *
 * Builds a ZIP containing the formatted text output, canonical export document,
 * archive metadata, and downloadable media files for the selected message set.
 */

import JSZip from 'jszip'
import type {
  ChatArchiveCallbacks,
  ChatArchiveFailure,
  ChatArchiveProgress,
  ChatArchiveResult,
  ChatArchiveTask,
  ChatExport,
  ChatMessage,
  FormatConfig,
  MediaType,
} from '@/types'
import { telegramService } from '../telegram/client'
import {
  formatDuration,
  Semaphore,
  startFloodWaitCountdown,
  withRetry,
} from '../telegram/rate-limiter'
import {
  buildExportDocument,
  formatMessages,
  getFormatFileExtension,
  prepareMessages,
} from './format-service'

const MAX_PARALLEL_DOWNLOADS = 4
const MAX_DOWNLOAD_RETRIES = 3
const DOWNLOADABLE_MEDIA_TYPES = new Set<MediaType>([
  'photo',
  'video',
  'document',
  'sticker',
  'voice',
  'videoNote',
  'audio',
  'animation',
])

interface ArchiveMediaEntry {
  blob: Blob
  filename: string
  path: string
}

class ChatArchiveBuildTask implements ChatArchiveTask {
  private readonly abortController = new AbortController()
  private readonly chatExport: ChatExport
  private readonly messages: ChatMessage[]
  private readonly config: FormatConfig
  private readonly callbacks: ChatArchiveCallbacks

  readonly signal = this.abortController.signal
  readonly promise: Promise<ChatArchiveResult>

  constructor(
    chatExport: ChatExport,
    messages: ChatMessage[],
    config: FormatConfig,
    callbacks: ChatArchiveCallbacks,
  ) {
    this.chatExport = chatExport
    this.messages = messages
    this.config = config
    this.callbacks = callbacks
    this.promise = this.run()
  }

  cancel = (): void => {
    this.abortController.abort()
  }

  private async run(): Promise<ChatArchiveResult> {
    const progress: ChatArchiveProgress = {
      phase: 'preparing',
      totalMediaMessages: 0,
      processedMediaMessages: 0,
      downloadedMediaMessages: 0,
      failedMediaMessages: 0,
      startTime: new Date(),
    }

    this.callbacks.onProgress?.({ ...progress })

    try {
      const selectedMessages = prepareMessages(this.messages, this.config)
      const formattedOutput = formatMessages(this.messages, this.chatExport, this.config)
      const mediaMessages = selectedMessages.filter((message) =>
        this.isDownloadableMediaMessage(message),
      )

      progress.totalMediaMessages = mediaMessages.length
      this.callbacks.onProgress?.({ ...progress })
      this.throwIfCancelled(progress)

      let rawMessages = new Map<number, unknown>()
      if (mediaMessages.length > 0) {
        progress.phase = 'fetching_messages'
        this.callbacks.onProgress?.({ ...progress })
        rawMessages = await telegramService.getChatMessagesByIds(
          this.chatExport.chatPeerId || this.chatExport.chatId,
          mediaMessages.map((message) => message.id),
        )
      }

      const mediaEntries = new Map<number, ArchiveMediaEntry>()
      const failures: ChatArchiveFailure[] = []

      if (mediaMessages.length > 0) {
        progress.phase = 'downloading_media'
        this.callbacks.onProgress?.({ ...progress })
        await this.downloadMediaEntries(
          mediaMessages,
          rawMessages,
          mediaEntries,
          failures,
          progress,
        )
      }

      this.throwIfCancelled(progress)

      progress.phase = 'building_archive'
      this.callbacks.onProgress?.({ ...progress })

      const zip = new JSZip()
      const formattedFilename = `context.${getFormatFileExtension(this.config.template)}`

      zip.file(formattedFilename, formattedOutput)

      const mediaPaths = new Map<number, string>()
      for (const [messageId, entry] of mediaEntries.entries()) {
        mediaPaths.set(messageId, entry.path)
      }

      const exportDocument = buildExportDocument(this.messages, this.chatExport, this.config, {
        mediaPaths,
        template: this.config.template,
      })

      zip.file(
        'metadata.json',
        JSON.stringify(
          {
            schemaVersion: 1,
            archiveCreatedAt: new Date().toISOString(),
            formattedFile: formattedFilename,
            includedMediaFiles: mediaEntries.size,
            failedMediaFiles: failures.length,
            failures,
          },
          null,
          2,
        ),
      )
      zip.file('messages.json', JSON.stringify(exportDocument, null, 2))

      const mediaFolder = zip.folder('media')
      if (mediaFolder) {
        for (const entry of mediaEntries.values()) {
          mediaFolder.file(entry.filename, entry.blob)
        }
      }

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })

      progress.phase = 'complete'
      this.callbacks.onProgress?.({ ...progress })

      return {
        blob,
        filename: this.buildArchiveFilename(this.chatExport, this.config),
        mediaFailures: failures,
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        progress.phase = 'cancelled'
      } else {
        progress.phase = 'error'
        progress.errorMessage = error instanceof Error ? error.message : String(error)
      }

      this.callbacks.onProgress?.({ ...progress })
      throw error
    }
  }

  private throwIfCancelled(progress: ChatArchiveProgress): void {
    if (!this.signal.aborted) {
      return
    }

    progress.phase = 'cancelled'
    this.callbacks.onProgress?.({ ...progress })
    throw new DOMException('Archive generation cancelled', 'AbortError')
  }

  private async downloadMediaEntries(
    messages: ChatMessage[],
    rawMessages: Map<number, unknown>,
    mediaEntries: Map<number, ArchiveMediaEntry>,
    failures: ChatArchiveFailure[],
    progress: ChatArchiveProgress,
  ): Promise<void> {
    const semaphore = new Semaphore(MAX_PARALLEL_DOWNLOADS)
    const usedNames = new Set<string>()

    const tasks = messages.map((message) =>
      semaphore.withPermit(async () => {
        this.throwIfCancelled(progress)
        progress.currentMessageId = message.id

        try {
          const rawMessage = rawMessages.get(message.id)
          if (!rawMessage) {
            throw new Error(`Message ${message.id} could not be reloaded from Telegram`)
          }

          const blob = await withRetry(() => telegramService.downloadMedia(rawMessage), {
            maxRetries: MAX_DOWNLOAD_RETRIES,
            signal: this.signal,
            onFloodWait: (seconds) => {
              this.callbacks.onFloodWait?.(seconds)
              if (this.callbacks.onFloodWaitCountdown) {
                this.startFloodWaitCountdown(seconds)
              }
            },
            onRetry: (attempt, waitMs, error) => {
              console.warn(
                `Retry ${attempt} for archive media ${message.id} after ${formatDuration(waitMs)}: ${error.message}`,
              )
            },
          })

          if (!blob) {
            throw new Error(`Media for message ${message.id} could not be downloaded`)
          }

          const filename = this.buildMediaFilename(message, blob, usedNames)
          mediaEntries.set(message.id, {
            blob,
            filename,
            path: `media/${filename}`,
          })
          progress.downloadedMediaMessages++
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw error
          }

          progress.failedMediaMessages++
          const failure = {
            messageId: message.id,
            errorMessage: error instanceof Error ? error.message : String(error),
          }
          failures.push(failure)
          this.callbacks.onError?.(
            error instanceof Error ? error : new Error(failure.errorMessage),
            message.id,
          )
        } finally {
          progress.processedMediaMessages++
          this.callbacks.onProgress?.({ ...progress })
        }
      }),
    )

    await Promise.all(tasks)
  }

  private startFloodWaitCountdown(seconds: number): void {
    const controller = new AbortController()
    const cancelCountdown = () => controller.abort()

    startFloodWaitCountdown(seconds, this.callbacks.onFloodWaitCountdown!, controller.signal)
    const timeoutId = globalThis.setTimeout(cancelCountdown, seconds * 1000)

    this.signal.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timeoutId)
        cancelCountdown()
      },
      { once: true },
    )
  }

  private isDownloadableMediaMessage(message: ChatMessage): boolean {
    if (!message.hasMedia) {
      return false
    }

    if (message.mediaFilename) {
      return true
    }

    return message.mediaType ? DOWNLOADABLE_MEDIA_TYPES.has(message.mediaType) : false
  }

  private buildArchiveFilename(chatExport: ChatExport, config: FormatConfig): string {
    return `${this.sanitizeFilename(chatExport.chatTitle)}_${this.formatDate(chatExport.createdAt)}_${config.template}.zip`
  }

  private buildMediaFilename(message: ChatMessage, blob: Blob, usedNames: Set<string>): string {
    const baseFilename = this.getBaseMediaFilename(message, blob)
    let candidate = `${message.id}_${baseFilename}`
    let suffix = 1

    while (usedNames.has(candidate)) {
      candidate = `${message.id}_${suffix}_${baseFilename}`
      suffix++
    }

    usedNames.add(candidate)
    return candidate
  }

  private getBaseMediaFilename(message: ChatMessage, blob: Blob): string {
    const sanitized = this.sanitizeFilename(message.mediaFilename || '')
    const existingExtension = this.getExtensionFromFilename(sanitized)
    const fallbackExtension =
      this.getExtensionFromFilename(message.mediaFilename) ||
      this.getExtensionFromMimeType(blob.type || message.mediaMimeType || '') ||
      this.getExtensionForMediaType(message.mediaType)

    if (sanitized) {
      return existingExtension || !fallbackExtension
        ? sanitized
        : `${sanitized}${fallbackExtension}`
    }

    return `${message.mediaType || 'media'}_${message.id}${fallbackExtension}`
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120)
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0] ?? ''
  }

  private getExtensionFromFilename(filename?: string): string {
    if (!filename) {
      return ''
    }

    const match = filename.match(/(\.[A-Za-z0-9]+)$/)
    return match?.[1]?.toLowerCase() || ''
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const map: Record<string, string> = {
      'application/pdf': '.pdf',
      'audio/mpeg': '.mp3',
      'audio/mp4': '.m4a',
      'audio/ogg': '.ogg',
      'image/gif': '.gif',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
    }

    return map[mimeType] || ''
  }

  private getExtensionForMediaType(mediaType?: MediaType): string {
    switch (mediaType) {
      case 'audio':
        return '.mp3'
      case 'photo':
      case 'sticker':
        return '.jpg'
      case 'video':
      case 'videoNote':
      case 'animation':
        return '.mp4'
      case 'voice':
        return '.ogg'
      default:
        return ''
    }
  }
}

class ChatArchiveService {
  createArchiveTask(
    chatExport: ChatExport,
    messages: ChatMessage[],
    config: FormatConfig,
    callbacks: ChatArchiveCallbacks = {},
  ): ChatArchiveTask {
    return new ChatArchiveBuildTask(chatExport, messages, config, callbacks)
  }

  async generateBlob(
    chatExport: ChatExport,
    messages: ChatMessage[],
    config: FormatConfig,
    callbacks: ChatArchiveCallbacks = {},
  ): Promise<Blob> {
    const result = await this.createArchiveTask(chatExport, messages, config, callbacks).promise
    return result.blob
  }

  async generateArchive(
    chatExport: ChatExport,
    messages: ChatMessage[],
    config: FormatConfig,
    callbacks: ChatArchiveCallbacks = {},
  ): Promise<ChatArchiveResult> {
    return this.createArchiveTask(chatExport, messages, config, callbacks).promise
  }

  async generateAndDownload(
    chatExport: ChatExport,
    messages: ChatMessage[],
    config: FormatConfig,
    callbacks: ChatArchiveCallbacks = {},
  ): Promise<ChatArchiveResult> {
    const result = await this.generateArchive(chatExport, messages, config, callbacks)
    this.downloadBlob(result.blob, result.filename)
    return result
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  }
}

export const chatArchiveService = new ChatArchiveService()
