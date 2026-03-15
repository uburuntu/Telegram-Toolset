/**
 * Chat History Service for LLM Context Export
 *
 * Orchestrates downloading chat history and storing it in IndexedDB.
 * Handles progress tracking, cancellation, and error recovery.
 */

import type {
  ChatExport,
  ChatHistoryCallbacks,
  ChatHistoryOptions,
  ChatHistoryProgress,
  ChatHistoryResult,
  ChatInfo,
  ChatMessage,
} from '@/types'
import * as db from '../storage/indexed-db'
import { telegramService } from '../telegram/client'
import { createFloodWaitSubscription } from '../telegram/rate-limiter'

class ChatHistoryService {
  private abortController: AbortController | null = null
  private _stopAndSave = false

  /**
   * Check if a download is currently in progress
   */
  get isDownloading(): boolean {
    return this.abortController !== null
  }

  /**
   * Cancel the current download operation (discards all fetched messages)
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Stop fetching and save whatever has been downloaded so far.
   * Unlike cancel(), this preserves the partial result.
   */
  stopAndSave(): void {
    this._stopAndSave = true
  }

  /**
   * Download chat history and save to IndexedDB
   *
   * @param chatInfo - Chat to download from
   * @param options - Download options (limit, date range)
   * @param callbacks - Progress and error callbacks
   */
  async downloadChatHistory(
    chatInfo: ChatInfo,
    options: ChatHistoryOptions = {},
    callbacks: ChatHistoryCallbacks = {},
  ): Promise<ChatHistoryResult> {
    // Create new abort controller for this download
    this.abortController = new AbortController()
    const signal = this.abortController.signal

    // Subscribe to FloodWait events from Telegram service
    const unsubscribeFloodWait = createFloodWaitSubscription(telegramService, callbacks, signal)

    const progress: ChatHistoryProgress = {
      phase: 'initializing',
      fetchedMessages: 0,
      startTime: new Date(),
    }

    const messages: ChatMessage[] = []
    let minDate: Date | undefined
    let maxDate: Date | undefined
    this._stopAndSave = false

    try {
      // Get estimated message count for progress
      progress.phase = 'initializing'
      callbacks.onProgress?.(progress)

      try {
        const estimatedCount = await telegramService.getChatMessageCount(chatInfo.id)
        progress.totalEstimate = options.limit
          ? Math.min(estimatedCount, options.limit)
          : estimatedCount
      } catch {
        // Ignore count estimation errors
      }

      // Start fetching messages
      progress.phase = 'fetching'
      callbacks.onProgress?.(progress)

      for await (const msg of telegramService.iterChatMessages(chatInfo.id, options)) {
        // Check for cancellation
        if (signal.aborted) {
          progress.phase = 'cancelled'
          callbacks.onProgress?.(progress)
          throw new DOMException('Download cancelled', 'AbortError')
        }

        // Check for stop-and-save
        if (this._stopAndSave) {
          break
        }

        // Resolve sender info
        const enrichedMsg = await this.enrichMessageWithSender(msg)
        messages.push(enrichedMsg)

        // Track date range
        if (!minDate || enrichedMsg.date < minDate) {
          minDate = enrichedMsg.date
        }
        if (!maxDate || enrichedMsg.date > maxDate) {
          maxDate = enrichedMsg.date
        }

        // Update progress
        progress.fetchedMessages = messages.length
        progress.currentMessageId = enrichedMsg.id
        callbacks.onProgress?.(progress)
        callbacks.onMessage?.(enrichedMsg)
      }

      // Check for empty result
      if (messages.length === 0) {
        throw new Error('No messages found in this chat')
      }

      // Create export metadata
      progress.phase = 'saving'
      callbacks.onProgress?.(progress)

      const chatExport: ChatExport = {
        id: this.generateExportId(),
        chatId: chatInfo.id,
        chatTitle: chatInfo.title,
        chatType: chatInfo.type,
        createdAt: new Date(),
        messageCount: messages.length,
        dateRange: {
          from: minDate || new Date(),
          to: maxDate || new Date(),
        },
      }

      // Save to IndexedDB
      await db.saveChatExport(chatExport)
      await db.saveChatMessages(chatExport.id, messages)

      // Complete
      progress.phase = 'complete'
      callbacks.onProgress?.(progress)

      return { messages, chatExport }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        progress.phase = 'cancelled'
      } else {
        progress.phase = 'error'
        progress.errorMessage = error instanceof Error ? error.message : String(error)
        callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
      callbacks.onProgress?.(progress)
      throw error
    } finally {
      unsubscribeFloodWait()
      this.abortController = null
    }
  }

  /**
   * Load a cached chat export from IndexedDB
   */
  async loadChatExport(exportId: string): Promise<ChatHistoryResult | null> {
    const chatExport = await db.getChatExport(exportId)
    if (!chatExport) return null

    const messages = await db.getChatMessagesByExport(exportId)

    return { messages, chatExport }
  }

  /**
   * Get all cached chat exports
   */
  async listChatExports(): Promise<ChatExport[]> {
    return db.getAllChatExports()
  }

  /**
   * Delete a cached chat export
   */
  async deleteChatExport(exportId: string): Promise<void> {
    await db.deleteChatExport(exportId)
  }

  /**
   * Get messages for a cached export
   */
  async getChatMessages(exportId: string): Promise<ChatMessage[]> {
    return db.getChatMessagesByExport(exportId)
  }

  /**
   * Enrich a message with sender name and username
   * Stores both senderName (potentially contact name) and senderOriginalName (peer's Telegram name)
   */
  private async enrichMessageWithSender(msg: ChatMessage): Promise<ChatMessage> {
    if (!msg.senderId) return msg

    try {
      const senderInfo = await telegramService.resolveSenderInfo(msg.senderId)
      // GramJS returns the peer's actual Telegram name, not contact names
      // We store it in both fields - senderOriginalName is the canonical source
      // senderName may be overwritten by contact name resolution in the future
      return {
        ...msg,
        senderName: senderInfo.name,
        senderOriginalName: senderInfo.name,
        senderUsername: senderInfo.username,
      }
    } catch {
      // Silently ignore entity resolution errors
      return msg
    }
  }

  /**
   * Generate a unique export ID
   */
  private generateExportId(): string {
    return `export_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Check if a chat has been exported before
   */
  async hasExistingExport(chatId: bigint): Promise<ChatExport | null> {
    const exports = await db.getAllChatExports()
    return exports.find((e) => e.chatId === chatId) || null
  }

  /**
   * Get storage size used by chat exports
   */
  async getTotalStorageSize(): Promise<number> {
    const exports = await db.getAllChatExports()
    let total = 0

    for (const exp of exports) {
      total += await db.getChatExportSize(exp.id)
    }

    return total
  }
}

// Singleton instance
export const chatHistoryService = new ChatHistoryService()
