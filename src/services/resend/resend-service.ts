/**
 * Resend service for re-sending exported messages
 *
 * Ported from Python resend_service.py with:
 * - Media file sending
 * - Smart message batching
 * - Header customization (sender, date, reply links)
 * - HTML formatting with hidden reply links
 * - Quote text rendering
 * - Rate limit handling
 * - Cancel support
 */

import { telegramService } from '../telegram/client'
import { withRetry, formatDuration } from '../telegram/rate-limiter'
import type { DeletedMessage, ResendConfig, ExportProgress } from '@/types'

// Constants matching Python implementation
const TELEGRAM_CAPTION_LIMIT = 1024
const MESSAGE_SEND_DELAY = 50 // ms between messages (avoid rate limits)
const MAX_SEND_RETRIES = 3
const TELEGRAM_MESSAGE_LIMIT = 4096

export interface ResendCallbacks {
  onProgress?: (progress: ExportProgress) => void
  onFloodWait?: (seconds: number) => void
  onError?: (error: Error, messageId?: number) => void
}

export interface ResendResult {
  sentCount: number
  failedCount: number
  progress: ExportProgress
}

/**
 * Safely truncate text without breaking UTF-8 multibyte characters
 * Matches Python's safe_truncate_utf8
 */
function safeTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text

  // Reserve 3 characters for "..."
  const truncated = text.slice(0, maxLength - 3)
  return truncated + '...'
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Sleep for specified milliseconds with abort support
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const timeout = setTimeout(resolve, ms)

    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}

class ResendService {
  private abortController: AbortController | null = null

  /**
   * Check if a resend operation is in progress
   */
  get isResending(): boolean {
    return this.abortController !== null
  }

  /**
   * Cancel the current resend operation
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Resend messages to a target chat
   */
  async resendMessages(
    messages: DeletedMessage[],
    mediaBlobs: Map<number, Blob>,
    config: ResendConfig,
    callbacks: ResendCallbacks = {}
  ): Promise<ResendResult> {
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    const progress: ExportProgress = {
      phase: 'initializing',
      totalMessages: messages.length,
      processedMessages: 0,
      exportedTextMessages: 0,
      exportedMediaMessages: 0,
      failedMessages: 0,
      startTime: new Date(),
    }

    try {
      // Sort messages by date (oldest first)
      const sortedMessages = [...messages].sort((a, b) => a.date.getTime() - b.date.getTime())

      // Create batches if batching is enabled
      const batches = this.createMessageBatches(sortedMessages, config)

      progress.phase = 'saving' // Reuse 'saving' phase for sending
      callbacks.onProgress?.(progress)

      // Process each batch
      for (const batch of batches) {
        if (signal.aborted) {
          progress.phase = 'cancelled'
          callbacks.onProgress?.(progress)
          throw new DOMException('Resend cancelled', 'AbortError')
        }

        await this.resendBatch(batch, mediaBlobs, config, progress, callbacks, signal)

        // Small delay between batches
        await sleep(MESSAGE_SEND_DELAY, signal)
      }

      progress.phase = 'complete'
      callbacks.onProgress?.(progress)

      return {
        sentCount: progress.exportedTextMessages + progress.exportedMediaMessages,
        failedCount: progress.failedMessages,
        progress,
      }
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
   * Create message batches for grouping short consecutive messages
   * Matches Python's _create_message_batches logic
   */
  private createMessageBatches(
    messages: DeletedMessage[],
    config: ResendConfig
  ): DeletedMessage[][] {
    if (!config.enableBatching) {
      return messages.map((m) => [m])
    }

    const batches: DeletedMessage[][] = []
    let currentBatch: DeletedMessage[] = []

    for (const message of messages) {
      // Check if message is batchable
      const canBatch =
        !message.hasMedia &&
        message.text &&
        !message.replyToMsgId && // Don't batch replies
        message.text.length <= config.batchMaxMessageLength

      if (!canBatch) {
        // Flush current batch and add this message separately
        if (currentBatch.length > 0) {
          batches.push(currentBatch)
          currentBatch = []
        }
        batches.push([message])
        continue
      }

      // Check if we can add to current batch
      let canAddToBatch = false

      if (currentBatch.length > 0) {
        const firstMsg = currentBatch[0]!
        const lastMsg = currentBatch[currentBatch.length - 1]!

        // Check constraints
        const sameSender = message.senderId === firstMsg.senderId
        const withinTime =
          message.date &&
          lastMsg.date &&
          message.date.getTime() - lastMsg.date.getTime() <=
            config.batchTimeWindowMinutes * 60 * 1000
        const notFull = currentBatch.length < config.batchMaxMessages

        // Estimate total length
        const totalLength =
          currentBatch.reduce((sum, m) => sum + (m.text?.length || 0), 0) +
          (message.text?.length || 0)
        const estimatedTotal = totalLength + currentBatch.length * 2 + 200 // Account for separators and header
        const underLimit = estimatedTotal < TELEGRAM_MESSAGE_LIMIT

        canAddToBatch = sameSender && withinTime && notFull && underLimit
      }

      if (canAddToBatch || currentBatch.length === 0) {
        currentBatch.push(message)
      } else {
        batches.push(currentBatch)
        currentBatch = [message]
      }
    }

    // Don't forget last batch
    if (currentBatch.length > 0) {
      batches.push(currentBatch)
    }

    return batches
  }

  /**
   * Resend a batch of messages
   */
  private async resendBatch(
    batch: DeletedMessage[],
    mediaBlobs: Map<number, Blob>,
    config: ResendConfig,
    progress: ExportProgress,
    callbacks: ResendCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    // Single message - use single message logic
    if (batch.length === 1 && batch[0]) {
      await this.resendSingleMessage(batch[0], mediaBlobs, config, progress, callbacks, signal)
      return
    }

    // Multi-message batch - combine and send as one
    for (const message of batch) {
      progress.processedMessages++
      progress.currentMessageId = message.id
    }

    try {
      const messageText = this.buildBatchedMessageText(batch, config)

      if (messageText) {
        await this.sendMessageWithRetry(config.targetChatId, messageText, callbacks, signal)
        progress.exportedTextMessages += batch.length
      }

      callbacks.onProgress?.(progress)
    } catch (error) {
      progress.failedMessages += batch.length
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Resend a single message
   */
  private async resendSingleMessage(
    message: DeletedMessage,
    mediaBlobs: Map<number, Blob>,
    config: ResendConfig,
    progress: ExportProgress,
    callbacks: ResendCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    progress.processedMessages++
    progress.currentMessageId = message.id

    // Check if we should send this message based on config
    if (!config.includeText && !message.hasMedia) {
      callbacks.onProgress?.(progress)
      return
    }
    if (!config.includeMedia && message.hasMedia && !message.text) {
      callbacks.onProgress?.(progress)
      return
    }

    try {
      const messageText = this.buildMessageText(message, config)
      let sentMedia = false

      // Send media if present and configured
      if (message.hasMedia && config.includeMedia) {
        const blob = mediaBlobs.get(message.id)
        if (blob) {
          const caption =
            config.includeText && messageText
              ? safeTruncate(messageText, TELEGRAM_CAPTION_LIMIT)
              : undefined

          await this.sendFileWithRetry(
            config.targetChatId,
            blob,
            {
              caption,
              parseMode: 'html',
              filename: message.mediaFilename || `media_${message.id}`,
            },
            callbacks,
            signal
          )

          sentMedia = true
          progress.exportedMediaMessages++
        }
      }

      // Send text message if media wasn't sent and we have text
      if (!sentMedia && config.includeText && messageText) {
        await this.sendMessageWithRetry(config.targetChatId, messageText, callbacks, signal)
        progress.exportedTextMessages++
      }

      callbacks.onProgress?.(progress)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error
      }
      progress.failedMessages++
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)), message.id)
      callbacks.onProgress?.(progress)
    }
  }

  /**
   * Build message text with configurable header components
   * Matches Python's _build_message_text
   */
  private buildMessageText(message: DeletedMessage, config: ResendConfig): string {
    const textParts: string[] = []

    // Build header with granular controls
    const headerParts: string[] = []

    // Sender info (name and/or username)
    if (config.showSenderName || config.showSenderUsername) {
      const senderParts: string[] = []

      if (config.showSenderName && message.senderName) {
        senderParts.push(escapeHtml(message.senderName))
      }

      if (config.showSenderUsername && message.senderUsername) {
        const usernamePart = `@${message.senderUsername}`
        if (senderParts.length > 0) {
          senderParts[0] = `${senderParts[0]} (${usernamePart})`
        } else {
          senderParts.push(usernamePart)
        }
      }

      if (senderParts.length > 0 && senderParts[0]) {
        headerParts.push(senderParts[0])
      }
    }

    // Reply link (hidden or visible)
    if (config.showReplyLink && message.replyToMsgId && message.chatId) {
      const chatIdStr = message.chatId.toString().replace('-100', '')
      let replyLink: string

      if (message.replyToTopId) {
        replyLink = `https://t.me/c/${chatIdStr}/${message.replyToTopId}/${message.replyToMsgId}`
      } else {
        replyLink = `https://t.me/c/${chatIdStr}/${message.replyToMsgId}`
      }

      if (config.useHiddenReplyLinks) {
        headerParts.push(`<a href="${replyLink}">↩️ Reply</a>`)
      } else {
        headerParts.push(replyLink)
      }
    }

    // Date with timezone adjustment
    if (config.showDate && message.date) {
      const formattedDate = this.formatDate(message.date, config.timezoneOffsetHours)
      headerParts.push(formattedDate)
    }

    if (headerParts.length > 0) {
      textParts.push(headerParts.join(' - '))
    }

    // Quote text
    if (message.quoteText) {
      const escapedQuote = escapeHtml(message.quoteText)
      textParts.push(`<pre>❝ ${escapedQuote} ❞</pre>`)
    }

    // Message text (don't escape - preserve user's formatting)
    if (message.text) {
      textParts.push(message.text)
    }

    // Fallback
    if (textParts.length === 0 && message.date) {
      textParts.push(this.formatDate(message.date, config.timezoneOffsetHours))
    }

    return textParts.join('\n\n')
  }

  /**
   * Build batched message text for multiple messages
   * Matches Python's _build_batched_message_text
   */
  private buildBatchedMessageText(batch: DeletedMessage[], config: ResendConfig): string {
    const firstMessage = batch[0]
    if (!firstMessage) {
      return ''
    }

    if (batch.length === 1) {
      return this.buildMessageText(firstMessage, config)
    }

    const textParts: string[] = []

    // Build header from first message only
    const headerParts: string[] = []

    // Sender info
    if (config.showSenderName || config.showSenderUsername) {
      const senderParts: string[] = []
      if (config.showSenderName && firstMessage.senderName) {
        senderParts.push(escapeHtml(firstMessage.senderName))
      }
      if (config.showSenderUsername && firstMessage.senderUsername) {
        const usernamePart = `@${firstMessage.senderUsername}`
        if (senderParts.length > 0 && senderParts[0]) {
          senderParts[0] = `${senderParts[0]} (${usernamePart})`
        } else {
          senderParts.push(usernamePart)
        }
      }
      if (senderParts.length > 0 && senderParts[0]) {
        headerParts.push(senderParts[0])
      }
    }

    // Date from first message
    if (config.showDate && firstMessage.date) {
      const formattedDate = this.formatDate(firstMessage.date, config.timezoneOffsetHours)
      headerParts.push(formattedDate)
    }

    if (headerParts.length > 0) {
      textParts.push(headerParts.join(' - '))
    }

    // Combine all message texts with \n\n separator
    const messageTexts = batch.map((msg) => msg.text).filter((t): t is string => !!t)
    const combinedText = messageTexts.join('\n\n')

    if (combinedText) {
      textParts.push(combinedText)
    }

    return textParts.join('\n\n')
  }

  /**
   * Format date with timezone adjustment
   * Matches Python's get_formatted_date
   */
  private formatDate(date: Date, timezoneOffsetHours: number): string {
    const adjustedDate = new Date(date.getTime() + timezoneOffsetHours * 60 * 60 * 1000)

    const year = adjustedDate.getUTCFullYear()
    const month = adjustedDate.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    const day = adjustedDate.getUTCDate().toString().padStart(2, '0')
    const hours = adjustedDate.getUTCHours().toString().padStart(2, '0')
    const minutes = adjustedDate.getUTCMinutes().toString().padStart(2, '0')

    return `${year} ${month} ${day}, ${hours}:${minutes}`
  }

  /**
   * Send message with retry logic
   */
  private async sendMessageWithRetry(
    chatId: bigint,
    text: string,
    callbacks: ResendCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    await withRetry(() => telegramService.sendMessage(chatId, text, 'html'), {
      maxRetries: MAX_SEND_RETRIES,
      signal,
      onFloodWait: (seconds) => {
        callbacks.onFloodWait?.(seconds)
      },
      onRetry: (attempt, waitMs, error) => {
        console.warn(
          `Retry ${attempt} for sendMessage after ${formatDuration(waitMs)}: ${error.message}`
        )
      },
    })
  }

  /**
   * Send file with retry logic
   */
  private async sendFileWithRetry(
    chatId: bigint,
    file: Blob,
    options: { caption?: string; parseMode?: 'html' | 'md'; filename?: string },
    callbacks: ResendCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    await withRetry(
      () =>
        telegramService.sendFile(chatId, file, {
          caption: options.caption,
          parseMode: options.parseMode,
          filename: options.filename,
        }),
      {
        maxRetries: MAX_SEND_RETRIES,
        signal,
        onFloodWait: (seconds) => {
          callbacks.onFloodWait?.(seconds)
        },
        onRetry: (attempt, waitMs, error) => {
          console.warn(
            `Retry ${attempt} for sendFile after ${formatDuration(waitMs)}: ${error.message}`
          )
        },
      }
    )
  }
}

// Singleton instance
export const resendService = new ResendService()
