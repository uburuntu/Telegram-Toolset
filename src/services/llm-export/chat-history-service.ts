/**
 * Chat History Service for LLM Context Export
 *
 * Coordinates Telegram history retrieval with local persistence, while keeping
 * each download request self-contained and cancellable.
 */

import type {
  ChatExport,
  ChatHistoryCallbacks,
  ChatHistoryOptions,
  ChatHistoryProgress,
  ChatHistoryResult,
  ChatHistoryTask,
  ChatInfo,
  ChatMessage,
} from '@/types'
import {
  deleteChatExport,
  getChatMessages,
  getTotalStorageSize as getStoredChatExportsSize,
  listChatExports,
  loadChatExportBundle,
  saveChatExportBundle,
} from './store'
import { telegramService } from '../telegram/client'
import { createFloodWaitSubscription } from '../telegram/rate-limiter'

class ChatHistoryDownloadTask implements ChatHistoryTask {
  private readonly abortController = new AbortController()
  private stopRequested = false
  private readonly chatInfo: ChatInfo
  private readonly options: ChatHistoryOptions
  private readonly callbacks: ChatHistoryCallbacks

  readonly signal = this.abortController.signal
  readonly promise: Promise<ChatHistoryResult>

  constructor(chatInfo: ChatInfo, options: ChatHistoryOptions, callbacks: ChatHistoryCallbacks) {
    this.chatInfo = chatInfo
    this.options = options
    this.callbacks = callbacks
    this.promise = this.run()
  }

  cancel = (): void => {
    this.abortController.abort()
  }

  stopAndSave = (): void => {
    this.stopRequested = true
  }

  private async run(): Promise<ChatHistoryResult> {
    const unsubscribeFloodWait = createFloodWaitSubscription(
      telegramService,
      this.callbacks,
      this.signal,
    )

    const progress: ChatHistoryProgress = {
      phase: 'initializing',
      fetchedMessages: 0,
      startTime: new Date(),
    }

    const messages: ChatMessage[] = []
    let minDate: Date | undefined
    let maxDate: Date | undefined

    try {
      this.callbacks.onProgress?.({ ...progress })

      try {
        const estimatedCount = await telegramService.getChatMessageCount(
          this.chatInfo.peerId || this.chatInfo.id,
        )
        progress.totalEstimate = this.options.limit
          ? Math.min(estimatedCount, this.options.limit)
          : estimatedCount
      } catch {
        // Progress estimation is best-effort only.
      }

      progress.phase = 'fetching'
      this.callbacks.onProgress?.({ ...progress })

      for await (const message of telegramService.iterChatMessages(
        this.chatInfo.peerId || this.chatInfo.id,
        this.options,
      )) {
        this.throwIfCancelled(progress)

        if (this.stopRequested) {
          break
        }

        const enrichedMessage = await this.enrichMessageWithSender(message)
        messages.push(enrichedMessage)

        if (!minDate || enrichedMessage.date < minDate) {
          minDate = enrichedMessage.date
        }
        if (!maxDate || enrichedMessage.date > maxDate) {
          maxDate = enrichedMessage.date
        }

        progress.fetchedMessages = messages.length
        progress.currentMessageId = enrichedMessage.id
        this.callbacks.onProgress?.({ ...progress })
        this.callbacks.onMessage?.(enrichedMessage)
      }

      this.throwIfCancelled(progress)

      if (messages.length === 0) {
        throw new Error('No messages found in this chat')
      }

      progress.phase = 'saving'
      this.callbacks.onProgress?.({ ...progress })

      const mediaCount = messages.filter((message) => message.hasMedia).length
      const chatExport: ChatExport = {
        id: this.generateExportId(),
        chatId: this.chatInfo.id,
        chatPeerId: this.chatInfo.peerId,
        chatTitle: this.chatInfo.title,
        chatType: this.chatInfo.type,
        schemaVersion: 2,
        createdAt: new Date(),
        messageCount: messages.length,
        hasMedia: mediaCount > 0,
        mediaCount,
        dateRange: {
          from: minDate || new Date(),
          to: maxDate || new Date(),
        },
      }

      const result = await saveChatExportBundle(chatExport, messages)

      progress.phase = 'complete'
      this.callbacks.onProgress?.({ ...progress })

      return result
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        progress.phase = 'cancelled'
      } else {
        progress.phase = 'error'
        progress.errorMessage = error instanceof Error ? error.message : String(error)
        this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
      }

      this.callbacks.onProgress?.({ ...progress })
      throw error
    } finally {
      unsubscribeFloodWait()
    }
  }

  private throwIfCancelled(progress: ChatHistoryProgress): void {
    if (!this.signal.aborted) {
      return
    }

    progress.phase = 'cancelled'
    this.callbacks.onProgress?.({ ...progress })
    throw new DOMException('Download cancelled', 'AbortError')
  }

  private async enrichMessageWithSender(message: ChatMessage): Promise<ChatMessage> {
    const senderRef = message.senderPeerId || message.senderId
    if (!senderRef) {
      return message
    }

    try {
      const senderInfo = await telegramService.resolveSenderInfo(senderRef)
      return {
        ...message,
        senderName: senderInfo.name,
        senderOriginalName: senderInfo.name,
        senderUsername: senderInfo.username,
      }
    } catch {
      return message
    }
  }

  private generateExportId(): string {
    return `export_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }
}

class ChatHistoryService {
  createDownloadTask(
    chatInfo: ChatInfo,
    options: ChatHistoryOptions = {},
    callbacks: ChatHistoryCallbacks = {},
  ): ChatHistoryTask {
    return new ChatHistoryDownloadTask(chatInfo, options, callbacks)
  }

  async downloadChatHistory(
    chatInfo: ChatInfo,
    options: ChatHistoryOptions = {},
    callbacks: ChatHistoryCallbacks = {},
  ): Promise<ChatHistoryResult> {
    return this.createDownloadTask(chatInfo, options, callbacks).promise
  }

  async loadChatExport(exportId: string): Promise<ChatHistoryResult | null> {
    return loadChatExportBundle(exportId)
  }

  async listChatExports(): Promise<ChatExport[]> {
    return listChatExports()
  }

  async deleteChatExport(exportId: string): Promise<void> {
    await deleteChatExport(exportId)
  }

  async getChatMessages(exportId: string): Promise<ChatMessage[]> {
    return getChatMessages(exportId)
  }

  async hasExistingExport(chatId: bigint): Promise<ChatExport | null> {
    const exports = await listChatExports()
    return exports.find((chatExport) => chatExport.chatId === chatId) || null
  }

  async getTotalStorageSize(): Promise<number> {
    return getStoredChatExportsSize()
  }
}

export const chatHistoryService = new ChatHistoryService()
