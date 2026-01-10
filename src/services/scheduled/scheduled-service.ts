/**
 * Scheduled messages service
 *
 * Provides functionality to:
 * - Fetch scheduled messages from specific chats or all dialogs
 * - Download as JSON for backup
 * - Delete scheduled messages
 */

import { telegramService } from '../telegram/client'
import { safeJsonStringify } from '@/utils/message-serialization'
import { withRetry, createFloodWaitSubscription } from '../telegram/rate-limiter'
import type { ScheduledMessage, ChatInfo } from '@/types'

export interface ScheduledMessagesProgress {
  phase: 'loading_chats' | 'fetching_messages' | 'complete' | 'error'
  totalChats: number
  processedChats: number
  totalMessages: number
  currentChat?: string
  error?: string
}

export interface ScheduledMessagesCallbacks {
  onProgress?: (progress: ScheduledMessagesProgress) => void
  onError?: (error: Error, chatId?: bigint) => void
  /** Called when a FloodWait error occurs with the wait time in seconds */
  onFloodWait?: (seconds: number) => void
  /** Called every second during flood wait with remaining seconds */
  onFloodWaitCountdown?: (remainingSeconds: number) => void
}

export interface ScheduledMessagesOptions {
  /** Maximum number of chats to scan (most recent by last message). Default: 100 */
  chatLimit?: number
}

export interface ChatWithScheduledMessages {
  chat: ChatInfo
  messages: ScheduledMessage[]
}

class ScheduledService {
  private abortController: AbortController | null = null

  get isLoading(): boolean {
    return this.abortController !== null
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Fetch scheduled messages from a single chat
   */
  async getScheduledMessagesForChat(
    chatId: bigint,
    callbacks: Pick<ScheduledMessagesCallbacks, 'onFloodWait' | 'onFloodWaitCountdown'> = {}
  ): Promise<ScheduledMessage[]> {
    const controller = new AbortController()
    const signal = controller.signal

    // Subscribe to global flood wait events from GramJS (it handles flood wait internally)
    const unsubscribeFloodWait = createFloodWaitSubscription(telegramService, callbacks, signal)

    try {
      return await telegramService.getScheduledMessages(chatId)
    } finally {
      unsubscribeFloodWait()
    }
  }

  /**
   * Fetch scheduled messages from all user's dialogs
   * Returns messages grouped by chat
   *
   * @param callbacks - Progress and error callbacks
   * @param options - Options including chatLimit (default 100)
   */
  async getAllScheduledMessages(
    callbacks: ScheduledMessagesCallbacks = {},
    options: ScheduledMessagesOptions = {}
  ): Promise<ChatWithScheduledMessages[]> {
    const chatLimit = options.chatLimit ?? 100

    this.abortController = new AbortController()
    const signal = this.abortController.signal

    // Subscribe to global flood wait events from GramJS (it handles flood wait internally)
    const unsubscribeFloodWait = createFloodWaitSubscription(telegramService, callbacks, signal)

    const progress: ScheduledMessagesProgress = {
      phase: 'loading_chats',
      totalChats: 0,
      processedChats: 0,
      totalMessages: 0,
    }

    try {
      callbacks.onProgress?.({ ...progress })

      // Get dialogs sorted by most recent message
      const dialogs = await telegramService.getDialogs(chatLimit)

      if (signal.aborted) {
        throw new Error('Operation cancelled')
      }

      // Filter chats: only channels require admin rights to view scheduled messages.
      // Private chats, groups, and supergroups allow any member to schedule messages.
      const eligibleChats = dialogs.filter((chat) => chat.type !== 'channel' || chat.isAdmin)

      progress.phase = 'fetching_messages'
      progress.totalChats = eligibleChats.length
      callbacks.onProgress?.({ ...progress })

      const results: ChatWithScheduledMessages[] = []

      for (const chat of eligibleChats) {
        if (signal.aborted) {
          throw new Error('Operation cancelled')
        }

        progress.currentChat = chat.title
        callbacks.onProgress?.({ ...progress })

        try {
          // Note: GramJS handles flood wait internally, so we use the global listener
          // instead of withRetry's onFloodWait. withRetry is still useful for other errors.
          const messages = await withRetry(() => telegramService.getScheduledMessages(chat.id), {
            maxRetries: 3,
            signal,
          })

          if (messages.length > 0) {
            // Add chat title to each message
            const messagesWithChat = messages.map((msg) => ({
              ...msg,
              chatTitle: chat.title,
            }))

            results.push({
              chat,
              messages: messagesWithChat,
            })

            progress.totalMessages += messages.length
          }
        } catch (error) {
          // Log but continue with other chats (unless cancelled)
          if ((error as Error).name === 'AbortError') {
            throw error
          }
          console.warn(`Failed to fetch scheduled messages for chat ${chat.title}:`, error)
          callbacks.onError?.(error as Error, chat.id)
        }

        progress.processedChats++
        callbacks.onProgress?.({ ...progress })
      }

      progress.phase = 'complete'
      progress.currentChat = undefined
      callbacks.onProgress?.({ ...progress })

      return results
    } catch (error) {
      progress.phase = 'error'
      progress.error = error instanceof Error ? error.message : 'Unknown error'
      callbacks.onProgress?.({ ...progress })
      throw error
    } finally {
      unsubscribeFloodWait()
      this.abortController = null
    }
  }

  /**
   * Delete scheduled messages from a chat
   */
  async deleteScheduledMessages(chatId: bigint, messageIds: number[]): Promise<void> {
    await telegramService.deleteScheduledMessages(chatId, messageIds)
  }

  /**
   * Export scheduled messages to JSON and trigger download
   */
  exportToJson(data: ChatWithScheduledMessages[]): void {
    const exportData = {
      exportedAt: new Date().toISOString(),
      totalMessages: data.reduce((sum, item) => sum + item.messages.length, 0),
      chats: data.map((item) => ({
        chat: {
          id: item.chat.id.toString(),
          title: item.chat.title,
          type: item.chat.type,
          username: item.chat.username,
        },
        messages: item.messages.map((msg) => ({
          id: msg.id,
          chatId: msg.chatId.toString(),
          text: msg.text,
          date: msg.date.toISOString(),
          scheduledDate: msg.scheduledDate.toISOString(),
          hasMedia: msg.hasMedia,
          mediaType: msg.mediaType,
          mediaFilename: msg.mediaFilename,
          mediaSize: msg.mediaSize,
          replyToMsgId: msg.replyToMsgId,
        })),
      })),
    }

    const json = safeJsonStringify(exportData, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `scheduled-messages-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  /**
   * Format scheduled date for display
   */
  formatScheduledDate(date: Date): string {
    const now = new Date()
    const diff = date.getTime() - now.getTime()

    // If in the past, show "Overdue"
    if (diff < 0) {
      return 'Overdue'
    }

    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) {
      return `In ${days} day${days > 1 ? 's' : ''}`
    }
    if (hours > 0) {
      return `In ${hours} hour${hours > 1 ? 's' : ''}`
    }
    if (minutes > 0) {
      return `In ${minutes} minute${minutes > 1 ? 's' : ''}`
    }
    return 'Soon'
  }
}

// Singleton instance
export const scheduledService = new ScheduledService()
