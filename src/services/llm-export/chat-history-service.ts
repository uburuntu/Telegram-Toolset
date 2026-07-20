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
  CommitOptions,
  SavedAccount,
} from '@/types'
import { listEvictedChatExportIds } from '../storage/content-health'
import { ownershipForAccount, toStoredOwnership } from '../storage/record-ownership'
import { telegramGateway } from '../telegram/gateway'
import { createFloodWaitSubscription } from '../telegram/rate-limiter'
import {
  archiveChatExportsForRemovedAccount,
  claimLegacyChatExport,
  deleteChatExport,
  getChatMessages,
  getTotalStorageSize as getStoredChatExportsSize,
  listArchivedChatExports,
  listChatExports,
  listChatExportsForAccount,
  listQuarantinedChatExports,
  loadChatExportBundle,
  reconcileChatExport,
  recoverArchivedChatExportsForAccount,
  saveChatExportBundle,
} from './store'

type ChatExportOwnerContext = SavedAccount

class ChatHistoryDownloadTask implements ChatHistoryTask {
  private readonly abortController = new AbortController()
  private stopRequested = false
  private readonly chatInfo: ChatInfo
  private readonly options: ChatHistoryOptions
  private readonly callbacks: ChatHistoryCallbacks
  private readonly owner: ChatExportOwnerContext | null
  private readonly commitOptions?: CommitOptions

  readonly signal = this.abortController.signal
  readonly promise: Promise<ChatHistoryResult>

  constructor(
    chatInfo: ChatInfo,
    options: ChatHistoryOptions,
    callbacks: ChatHistoryCallbacks,
    owner: ChatExportOwnerContext | null,
    commitOptions?: CommitOptions,
  ) {
    this.chatInfo = chatInfo
    this.options = options
    this.callbacks = callbacks
    this.owner = owner
    this.commitOptions = commitOptions
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
      telegramGateway.auth,
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
        const estimatedCount = await telegramGateway.history.getChatMessageCount(
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

      for await (const message of telegramGateway.history.iterChatMessages(
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
        peerRef: this.chatInfo.peerRef,
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
        ...toStoredOwnership(ownershipForAccount(this.owner)),
      }

      const result = await saveChatExportBundle(chatExport, messages, this.commitOptions)

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
      const senderInfo = await telegramGateway.entities.resolveSenderInfo(senderRef)
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
    owner: ChatExportOwnerContext | null = null,
    commitOptions?: CommitOptions,
  ): ChatHistoryTask {
    return new ChatHistoryDownloadTask(chatInfo, options, callbacks, owner, commitOptions)
  }

  async downloadChatHistory(
    chatInfo: ChatInfo,
    options: ChatHistoryOptions = {},
    callbacks: ChatHistoryCallbacks = {},
    owner: ChatExportOwnerContext | null = null,
    commitOptions?: CommitOptions,
  ): Promise<ChatHistoryResult> {
    return this.createDownloadTask(chatInfo, options, callbacks, owner, commitOptions).promise
  }

  async loadChatExport(
    exportId: string,
    accessor: SavedAccount | null,
  ): Promise<ChatHistoryResult | null> {
    return loadChatExportBundle(exportId, accessor)
  }

  async listChatExports(): Promise<ChatExport[]> {
    return listChatExports()
  }

  async listChatExportsForAccount(account: SavedAccount | null): Promise<ChatExport[]> {
    return listChatExportsForAccount(account)
  }

  async listArchivedChatExports(): Promise<ChatExport[]> {
    return listArchivedChatExports()
  }

  async listQuarantinedChatExports(): Promise<ChatExport[]> {
    return listQuarantinedChatExports()
  }

  /**
   * Ids of chat exports whose message content was lost to browser eviction (metadata survives).
   * Callers surface these as recoverable-but-empty (re-export) without hiding the rest of the list.
   */
  async listEvictedChatExportIds(chatExports: ChatExport[]): Promise<Set<string>> {
    return listEvictedChatExportIds(chatExports)
  }

  async deleteChatExport(exportId: string, accessor: SavedAccount | null): Promise<void> {
    await deleteChatExport(exportId, accessor)
  }

  async claimLegacyChatExport(exportId: string, account: SavedAccount): Promise<ChatExport> {
    return claimLegacyChatExport(exportId, account)
  }

  async reconcileChatExport(exportId: string, account: SavedAccount): Promise<ChatExport> {
    return reconcileChatExport(exportId, account)
  }

  async getChatMessages(exportId: string, accessor: SavedAccount | null): Promise<ChatMessage[]> {
    return getChatMessages(exportId, accessor)
  }

  async hasExistingExport(chatId: bigint): Promise<ChatExport | null> {
    const exports = await listChatExports()
    return exports.find((chatExport) => chatExport.chatId === chatId) || null
  }

  async archiveChatExportsForRemovedAccount(account: SavedAccount): Promise<number> {
    return archiveChatExportsForRemovedAccount(account)
  }

  async recoverArchivedChatExportsForAccount(account: SavedAccount): Promise<number> {
    return recoverArchivedChatExportsForAccount(account)
  }

  async getTotalStorageSize(): Promise<number> {
    return getStoredChatExportsSize()
  }
}

export const chatHistoryService = new ChatHistoryService()
