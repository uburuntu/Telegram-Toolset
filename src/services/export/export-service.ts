/**
 * Export service for deleted messages
 *
 * Ported from Python export_service.py with:
 * - Two-phase export (metadata first, then media)
 * - Parallel media downloads with concurrency limit
 * - FloodWait handling and retry logic
 * - Cancel support via AbortController
 * - Sender name resolution
 */

import type { AdminLogIterOptions, DeletedMessage, ExportConfig, ExportProgress } from '@/types'
import { safeJsonStringify } from '@/utils/message-serialization'
import { telegramService } from '../telegram/client'
import {
  formatDuration,
  Semaphore,
  startFloodWaitCountdown,
  withRetry,
} from '../telegram/rate-limiter'

// Constants matching Python implementation
const MAX_PARALLEL_DOWNLOADS = 4
const MAX_DOWNLOAD_RETRIES = 3

export interface ExportCallbacks {
  onProgress?: (progress: ExportProgress) => void
  onFloodWait?: (seconds: number) => void
  onError?: (error: Error, messageId?: number) => void
  /** Called with remaining seconds during FloodWait countdown */
  onFloodWaitCountdown?: (remainingSeconds: number) => void
}

export interface ExportResult {
  messages: DeletedMessage[]
  mediaBlobs: Map<number, Blob>
  progress: ExportProgress
}

export interface ExportOptions extends AdminLogIterOptions {
  /** Validate chat before export (default: true) */
  validateFirst?: boolean
  /** Minimum date (export messages on or after this date) */
  minDate?: Date
  /** Maximum date (export messages on or before this date) */
  maxDate?: Date
}

class ExportService {
  private abortController: AbortController | null = null

  /**
   * Check if an export is currently in progress
   */
  get isExporting(): boolean {
    return this.abortController !== null
  }

  /**
   * Cancel the current export operation
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Export deleted messages from a chat
   *
   * Uses two-phase approach:
   * 1. Fast metadata extraction from admin log
   * 2. Parallel media downloads
   *
   * @param config - Export configuration (chatId, exportMode, etc.)
   * @param callbacks - Progress and error callbacks
   * @param options - Additional options (minId, maxId, limit, validateFirst)
   */
  async exportDeletedMessages(
    config: ExportConfig,
    callbacks: ExportCallbacks = {},
    options: ExportOptions = {},
  ): Promise<ExportResult> {
    // Create new abort controller for this export
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    const progress: ExportProgress = {
      phase: 'initializing',
      totalMessages: 0,
      processedMessages: 0,
      exportedTextMessages: 0,
      exportedMediaMessages: 0,
      failedMessages: 0,
      startTime: new Date(),
    }

    const messages: DeletedMessage[] = []
    const mediaBlobs = new Map<number, Blob>()
    const messagesWithMedia: DeletedMessage[] = []

    try {
      // Validate chat first (unless explicitly skipped)
      if (options.validateFirst !== false) {
        const validation = await telegramService.validateChatForExport(config.chatId)
        if (!validation.canExport) {
          throw new Error(validation.errorMessage || 'Cannot export from this chat')
        }
      }

      // Phase 1: Collect metadata
      progress.phase = 'fetching_metadata'
      callbacks.onProgress?.(progress)

      // Build iteration options from both ExportOptions and ExportConfig
      const iterOptions: AdminLogIterOptions = {}
      if (options.minId !== undefined) iterOptions.minId = options.minId
      if (options.maxId !== undefined) iterOptions.maxId = options.maxId
      if (options.limit !== undefined) iterOptions.limit = options.limit

      // Date filters from config
      if (config.minDate !== undefined) iterOptions.minDate = config.minDate
      if (config.maxDate !== undefined) iterOptions.maxDate = config.maxDate
      // Also allow overriding from options
      if (options.minDate !== undefined) iterOptions.minDate = options.minDate
      if (options.maxDate !== undefined) iterOptions.maxDate = options.maxDate

      for await (const msg of telegramService.iterDeletedMessages(config.chatId, iterOptions)) {
        // Check for cancellation
        if (signal.aborted) {
          progress.phase = 'cancelled'
          callbacks.onProgress?.(progress)
          throw new DOMException('Export cancelled', 'AbortError')
        }

        // Resolve sender information
        const enrichedMsg = await this.enrichMessageWithSender(msg)
        messages.push(enrichedMsg)

        // Track messages with media for phase 2
        if (enrichedMsg.hasMedia && config.exportMode !== 'text_only') {
          messagesWithMedia.push(enrichedMsg)
        }

        // Count text messages
        if (enrichedMsg.text) {
          progress.exportedTextMessages++
        }

        progress.processedMessages = messages.length
        progress.currentMessageId = enrichedMsg.id
        callbacks.onProgress?.(progress)
      }

      progress.totalMessages = messages.length

      // Phase 2: Download media in parallel
      if (messagesWithMedia.length > 0 && config.exportMode !== 'text_only') {
        progress.phase = 'downloading_media'
        progress.processedMessages = 0
        progress.totalMessages = messagesWithMedia.length
        callbacks.onProgress?.(progress)

        await this.downloadMediaParallel(messagesWithMedia, mediaBlobs, progress, callbacks, signal)
      }

      // Complete
      progress.phase = 'complete'
      callbacks.onProgress?.(progress)

      return { messages, mediaBlobs, progress }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        progress.phase = 'cancelled'
      } else {
        progress.phase = 'error'
        progress.errorMessage = error instanceof Error ? error.message : String(error)
      }
      callbacks.onProgress?.(progress)
      throw error
    } finally {
      this.abortController = null
    }
  }

  /**
   * Validate a chat for export without starting the export
   * Useful for UI validation before showing export options
   */
  async validateChat(chatId: bigint) {
    return telegramService.validateChatForExport(chatId)
  }

  /**
   * Enrich a message with sender name and username
   * Uses telegramService's cached entity lookup
   */
  private async enrichMessageWithSender(msg: DeletedMessage): Promise<DeletedMessage> {
    if (!msg.senderId) return msg

    try {
      const senderInfo = await telegramService.resolveSenderInfo(msg.senderId)
      msg.senderName = senderInfo.name
      msg.senderUsername = senderInfo.username
    } catch {
      // Silently ignore entity resolution errors
    }

    return msg
  }

  /**
   * Download media for messages in parallel
   */
  private async downloadMediaParallel(
    messages: DeletedMessage[],
    mediaBlobs: Map<number, Blob>,
    progress: ExportProgress,
    callbacks: ExportCallbacks,
    signal: AbortSignal,
  ): Promise<void> {
    const semaphore = new Semaphore(MAX_PARALLEL_DOWNLOADS)

    const downloadTasks = messages.map((msg) =>
      semaphore.withPermit(async () => {
        if (signal.aborted) return

        try {
          const blob = await this.downloadMediaWithRetry(msg, callbacks, signal)
          if (blob) {
            mediaBlobs.set(msg.id, blob)
            progress.exportedMediaMessages++
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            throw error
          }
          progress.failedMessages++
          callbacks.onError?.(error instanceof Error ? error : new Error(String(error)), msg.id)
        } finally {
          progress.processedMessages++
          progress.currentMessageId = msg.id

          callbacks.onProgress?.(progress)
        }
      }),
    )

    // Wait for all downloads, but stop on abort
    try {
      await Promise.all(downloadTasks)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }
      // Other errors are already handled per-task
    }
  }

  /**
   * Download media with retry logic
   * Uses the preserved _rawMessage for accurate media download
   */
  private async downloadMediaWithRetry(
    msg: DeletedMessage,
    callbacks: ExportCallbacks,
    signal: AbortSignal,
  ): Promise<Blob | null> {
    return withRetry(
      async () => {
        // Use downloadMessageMedia which handles _rawMessage properly
        const blob = await telegramService.downloadMessageMedia(msg)
        return blob
      },
      {
        maxRetries: MAX_DOWNLOAD_RETRIES,
        signal,
        onFloodWait: (seconds) => {
          callbacks.onFloodWait?.(seconds)

          // Start countdown if callback is provided
          if (callbacks.onFloodWaitCountdown) {
            startFloodWaitCountdown(seconds, callbacks.onFloodWaitCountdown, signal)
          }
        },
        onRetry: (attempt, waitMs, error) => {
          console.warn(
            `Retry ${attempt} for message ${msg.id} after ${formatDuration(waitMs)}: ${error.message}`,
          )
        },
      },
    )
  }

  /**
   * Estimate export size (rough approximation)
   */
  estimateExportSize(messages: DeletedMessage[], mediaBlobs: Map<number, Blob>): number {
    let size = 0

    // Estimate JSON metadata size (use BigInt-safe stringify because messages contain bigint IDs)
    size += safeJsonStringify(messages).length

    // Add media blob sizes
    for (const blob of mediaBlobs.values()) {
      size += blob.size
    }

    return size
  }
}

// Singleton instance
export const exportService = new ExportService()
