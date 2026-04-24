/**
 * Archive generation for LLM exports.
 *
 * Builds a ZIP containing the formatted text output, machine-readable metadata,
 * and any downloadable media files referenced by the selected message set.
 */

import JSZip from 'jszip'
import type {
  ChatArchiveCallbacks,
  ChatArchiveProgress,
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
import { formatMessages, getFormatFileExtension, prepareMessages } from './format-service'

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
  'contact',
])

interface ArchiveMediaEntry {
  blob: Blob
  filename: string
  path: string
}

class ChatArchiveService {
  async generateBlob(
    chatExport: ChatExport,
    messages: ChatMessage[],
    config: FormatConfig,
    callbacks: ChatArchiveCallbacks = {},
  ): Promise<Blob> {
    const progress: ChatArchiveProgress = {
      phase: 'preparing',
      totalMediaMessages: 0,
      processedMediaMessages: 0,
      downloadedMediaMessages: 0,
      failedMediaMessages: 0,
      startTime: new Date(),
    }

    callbacks.onProgress?.({ ...progress })

    try {
      const selectedMessages = prepareMessages(messages, config)
      const formattedOutput = formatMessages(messages, chatExport, config)
      const mediaMessages = selectedMessages.filter((message) =>
        this.isDownloadableMediaMessage(message),
      )

      progress.totalMediaMessages = mediaMessages.length
      callbacks.onProgress?.({ ...progress })

      let rawMessages = new Map<number, unknown>()
      if (mediaMessages.length > 0) {
        progress.phase = 'fetching_messages'
        callbacks.onProgress?.({ ...progress })
        rawMessages = await telegramService.getChatMessagesByIds(
          chatExport.chatId,
          mediaMessages.map((message) => message.id),
        )
      }

      const mediaEntries = new Map<number, ArchiveMediaEntry>()
      if (mediaMessages.length > 0) {
        progress.phase = 'downloading_media'
        callbacks.onProgress?.({ ...progress })
        await this.downloadMediaEntries(
          mediaMessages,
          rawMessages,
          mediaEntries,
          progress,
          callbacks,
        )
      }

      progress.phase = 'building_archive'
      callbacks.onProgress?.({ ...progress })

      const zip = new JSZip()
      const formattedFilename = `context.${getFormatFileExtension(config.template)}`

      zip.file(formattedFilename, formattedOutput)
      zip.file(
        'metadata.json',
        JSON.stringify(
          {
            exportId: chatExport.id,
            chatId: chatExport.chatId.toString(),
            chatTitle: chatExport.chatTitle,
            chatType: chatExport.chatType,
            exportCreatedAt: chatExport.createdAt.toISOString(),
            archiveCreatedAt: new Date().toISOString(),
            totalCachedMessages: chatExport.messageCount,
            selectedMessages: selectedMessages.length,
            includedMediaFiles: mediaEntries.size,
            failedMediaFiles: progress.failedMediaMessages,
            formattedFile: formattedFilename,
            format: this.serializeFormatConfig(config),
          },
          null,
          2,
        ),
      )
      zip.file(
        'messages.json',
        JSON.stringify(
          selectedMessages.map((message) =>
            this.serializeMessage(message, mediaEntries.get(message.id)?.path),
          ),
          null,
          2,
        ),
      )

      const mediaFolder = zip.folder('media')
      if (mediaFolder) {
        for (const entry of mediaEntries.values()) {
          mediaFolder.file(entry.filename, entry.blob)
        }
      }

      const archive = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      })

      progress.phase = 'complete'
      callbacks.onProgress?.({ ...progress })

      return archive
    } catch (error) {
      progress.phase = 'error'
      progress.errorMessage = error instanceof Error ? error.message : String(error)
      callbacks.onProgress?.({ ...progress })
      throw error
    }
  }

  async generateAndDownload(
    chatExport: ChatExport,
    messages: ChatMessage[],
    config: FormatConfig,
    callbacks: ChatArchiveCallbacks = {},
  ): Promise<void> {
    const archive = await this.generateBlob(chatExport, messages, config, callbacks)
    this.downloadBlob(archive, this.buildArchiveFilename(chatExport, config))
  }

  private async downloadMediaEntries(
    messages: ChatMessage[],
    rawMessages: Map<number, unknown>,
    mediaEntries: Map<number, ArchiveMediaEntry>,
    progress: ChatArchiveProgress,
    callbacks: ChatArchiveCallbacks,
  ): Promise<void> {
    const semaphore = new Semaphore(MAX_PARALLEL_DOWNLOADS)
    const usedNames = new Set<string>()

    const tasks = messages.map((message) =>
      semaphore.withPermit(async () => {
        progress.currentMessageId = message.id

        try {
          const rawMessage = rawMessages.get(message.id)
          if (!rawMessage) {
            throw new Error(`Message ${message.id} could not be reloaded from Telegram`)
          }

          const blob = await withRetry(() => telegramService.downloadMedia(rawMessage), {
            maxRetries: MAX_DOWNLOAD_RETRIES,
            onFloodWait: (seconds) => {
              callbacks.onFloodWait?.(seconds)

              if (callbacks.onFloodWaitCountdown) {
                const controller = new AbortController()
                startFloodWaitCountdown(seconds, callbacks.onFloodWaitCountdown, controller.signal)
                setTimeout(() => controller.abort(), seconds * 1000)
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
          progress.failedMediaMessages++
          callbacks.onError?.(error instanceof Error ? error : new Error(String(error)), message.id)
        } finally {
          progress.processedMediaMessages++
          callbacks.onProgress?.({ ...progress })
        }
      }),
    )

    await Promise.all(tasks)
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

  private serializeFormatConfig(config: FormatConfig) {
    return {
      ...config,
      filterDateRange: config.filterDateRange
        ? {
            from: config.filterDateRange.from?.toISOString(),
            to: config.filterDateRange.to?.toISOString(),
          }
        : undefined,
    }
  }

  private serializeMessage(message: ChatMessage, mediaPath?: string) {
    return {
      id: message.id,
      chatId: message.chatId.toString(),
      senderId: message.senderId?.toString(),
      senderName: message.senderName,
      senderOriginalName: message.senderOriginalName,
      senderUsername: message.senderUsername,
      text: message.text,
      date: message.date.toISOString(),
      replyToMsgId: message.replyToMsgId,
      forwardedFrom: message.forwardedFrom,
      media: message.hasMedia
        ? {
            type: message.mediaType,
            filename: message.mediaFilename,
            size: message.mediaSize,
            mimeType: message.mediaMimeType,
            path: mediaPath,
          }
        : undefined,
    }
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
      'text/vcard': '.vcf',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
    }

    return map[mimeType] || ''
  }

  private getExtensionForMediaType(mediaType?: MediaType): string {
    switch (mediaType) {
      case 'audio':
        return '.mp3'
      case 'contact':
        return '.vcf'
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
