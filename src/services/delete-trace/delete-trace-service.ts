import { telegramGateway } from '@/services/telegram/gateway'
import type {
  TelegramAuthSessionGateway,
  TelegramTraceGateway,
} from '@/services/telegram/gateway/contracts'
import {
  createFloodWaitSubscription,
  isFloodWaitError,
  startFloodWaitCountdown,
  withRetry,
} from '@/services/telegram/rate-limiter'
import type { ChatInfo, DeliveryOutcome, MultiPeerResult, PeerOutcome } from '@/types'

const SEARCH_PAGE_SIZE = 100
const DELETE_BATCH_SIZE = 100
const READ_ATTEMPTS = 4
const DELETE_ATTEMPTS = 4

export interface TraceDateRange {
  minDate?: Date
  maxDate?: Date
}

export interface TraceChatScan {
  chat: ChatInfo
  messageIds: number[]
  oldestDate?: Date
  newestDate?: Date
  error?: string
}

export interface TraceScanResult {
  chats: TraceChatScan[]
  totalMessages: number
  failedChats: number
}

export interface TraceScanProgress {
  processedChats: number
  totalChats: number
  foundMessages: number
  currentChat?: string
  currentChatFound: number
  currentChatEstimate?: number
}

export interface TraceDeleteProgress {
  processedBatches: number
  totalBatches: number
  confirmedMessages: number
  requestedMessages: number
  currentChat?: string
}

export interface TraceDeletionResult extends MultiPeerResult {
  requestedMessages: number
}

export interface TraceCallbacks {
  onFloodWait?: (seconds: number) => void
  onFloodWaitCountdown?: (remainingSeconds: number) => void
  onError?: (error: Error, chat: ChatInfo) => void
}

export interface TraceScanCallbacks extends TraceCallbacks {
  onProgress?: (progress: TraceScanProgress) => void
}

export interface TraceDeleteCallbacks extends TraceCallbacks {
  onProgress?: (progress: TraceDeleteProgress) => void
  onPeerSettled?: (outcome: PeerOutcome) => void
}

interface TraceServiceGateway {
  auth: TelegramAuthSessionGateway
  trace: TelegramTraceGateway
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError('Trace operation cancelled')
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function errorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const value = (error as { code?: unknown }).code
  return typeof value === 'number' ? value : undefined
}

/** Permanent 4xx RPC failures were rejected by Telegram and are not useful to retry. */
export function isRetryableTraceDeleteError(error: Error): boolean {
  if (error.name === 'AbortError') return false
  if (isFloodWaitError(error)) return true
  // GramJS already retried this request internally; repeating that loop only multiplies load.
  if (/Request was unsuccessful \d+ time\(s\)/i.test(error.message)) return false

  const code = errorCode(error)
  return code === undefined || code >= 500
}

function isPermanentRpcFailure(error: unknown): boolean {
  if (isFloodWaitError(error)) return false
  const code = errorCode(error)
  return code !== undefined && code >= 400 && code < 500
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

export class DeleteTraceService {
  constructor(private readonly gateway: TraceServiceGateway = telegramGateway) {}

  async scan(
    chats: readonly ChatInfo[],
    range: TraceDateRange = {},
    callbacks: TraceScanCallbacks = {},
    signal?: AbortSignal,
  ): Promise<TraceScanResult> {
    const operationSignal = signal ?? new AbortController().signal
    const unsubscribeFloodWait = createFloodWaitSubscription(
      this.gateway.auth,
      callbacks,
      operationSignal,
    )
    const results: TraceChatScan[] = []
    let foundMessages = 0

    const report = (
      processedChats: number,
      currentChat?: string,
      currentChatFound = 0,
      currentChatEstimate?: number,
    ): void => {
      callbacks.onProgress?.({
        processedChats,
        totalChats: chats.length,
        foundMessages,
        currentChat,
        currentChatFound,
        currentChatEstimate,
      })
    }

    try {
      report(0)

      for (let chatIndex = 0; chatIndex < chats.length; chatIndex++) {
        throwIfAborted(operationSignal)
        const chat = chats[chatIndex]!
        const messageIds = new Set<number>()
        let oldestDate: Date | undefined
        let newestDate: Date | undefined
        let offsetId = 0

        report(chatIndex, chat.title)

        try {
          while (true) {
            throwIfAborted(operationSignal)
            const page = await withRetry(
              () =>
                this.gateway.trace.searchOwnMessages(chat.id, {
                  ...range,
                  offsetId,
                  limit: SEARCH_PAGE_SIZE,
                }),
              {
                maxRetries: READ_ATTEMPTS,
                signal: operationSignal,
                onFloodWait: (seconds) =>
                  this.reportExplicitFloodWait(seconds, callbacks, operationSignal),
              },
            )

            for (const message of page.messages) {
              if (messageIds.has(message.id)) continue
              messageIds.add(message.id)
              foundMessages++
              if (!oldestDate || message.date < oldestDate) oldestDate = message.date
              if (!newestDate || message.date > newestDate) newestDate = message.date
            }

            report(chatIndex, chat.title, messageIds.size, page.total)

            if (
              page.nextOffsetId === undefined ||
              page.nextOffsetId === offsetId ||
              (page.total > 0 && messageIds.size >= page.total)
            ) {
              break
            }
            offsetId = page.nextOffsetId
          }

          results.push({
            chat,
            messageIds: [...messageIds],
            oldestDate,
            newestDate,
          })
        } catch (error) {
          if (operationSignal.aborted || (error instanceof Error && error.name === 'AbortError')) {
            throw error
          }

          // A partial scan is not safe to delete from: discard it and make the failed chat explicit.
          foundMessages -= messageIds.size
          const normalized = error instanceof Error ? error : new Error(String(error))
          results.push({ chat, messageIds: [], error: normalized.message })
          callbacks.onError?.(normalized, chat)
        }

        report(chatIndex + 1)
      }

      return {
        chats: results,
        totalMessages: foundMessages,
        failedChats: results.filter((result) => result.error).length,
      }
    } finally {
      unsubscribeFloodWait()
    }
  }

  async delete(
    scans: readonly TraceChatScan[],
    callbacks: TraceDeleteCallbacks = {},
    signal?: AbortSignal,
  ): Promise<TraceDeletionResult> {
    const operationSignal = signal ?? new AbortController().signal
    const actionableScans = scans.filter((scan) => !scan.error && scan.messageIds.length > 0)
    const batchesByChat = actionableScans.map((scan) => ({
      scan,
      batches: chunks(scan.messageIds, DELETE_BATCH_SIZE),
    }))
    const totalBatches = batchesByChat.reduce((total, item) => total + item.batches.length, 0)
    const requestedMessages = actionableScans.reduce(
      (total, scan) => total + scan.messageIds.length,
      0,
    )
    const outcomes: PeerOutcome[] = []
    let processedBatches = 0
    let confirmedMessages = 0

    const unsubscribeFloodWait = createFloodWaitSubscription(
      this.gateway.auth,
      callbacks,
      operationSignal,
    )
    const report = (currentChat?: string): void => {
      callbacks.onProgress?.({
        processedBatches,
        totalBatches,
        confirmedMessages,
        requestedMessages,
        currentChat,
      })
    }
    const settle = (outcome: PeerOutcome): void => {
      outcomes.push(outcome)
      callbacks.onPeerSettled?.(outcome)
    }

    try {
      report()

      for (const { scan, batches } of batchesByChat) {
        const peerId = scan.chat.id.toString()
        let affected = 0
        let terminalStatus: DeliveryOutcome | undefined
        let terminalError: string | undefined

        if (operationSignal.aborted) {
          settle({ peerId, status: 'skipped', affected: 0 })
          continue
        }

        for (const batch of batches) {
          if (operationSignal.aborted) {
            terminalStatus = affected > 0 ? 'abandoned' : 'skipped'
            break
          }

          try {
            // Repeating deletion by the same IDs has the same final state, so transient and
            // FLOOD_WAIT failures are safe to retry. Permanent RPC rejections stop immediately.
            await withRetry(() => this.gateway.trace.deleteMessages(scan.chat.id, batch), {
              maxRetries: DELETE_ATTEMPTS,
              signal: operationSignal,
              shouldRetry: isRetryableTraceDeleteError,
              onFloodWait: (seconds) =>
                this.reportExplicitFloodWait(seconds, callbacks, operationSignal),
            })
            affected += batch.length
            confirmedMessages += batch.length
          } catch (error) {
            terminalError = errorMessage(error)

            if (isPermanentRpcFailure(error)) {
              terminalStatus = 'failed'
            } else if (operationSignal.aborted) {
              // A request was already submitted. Until it can be read back, cancellation makes its
              // server outcome unknown rather than safely "skipped".
              terminalStatus = 'delivery_uncertain'
            } else {
              const reconciled = await this.reconcileBatch(
                scan.chat,
                batch,
                callbacks,
                operationSignal,
              )
              if (reconciled) {
                const deletedCount = batch.length - reconciled.existingIds.length
                affected += deletedCount
                confirmedMessages += deletedCount
                if (reconciled.existingIds.length === 0) {
                  terminalError = undefined
                } else {
                  terminalStatus = 'failed'
                }
              } else {
                terminalStatus = 'delivery_uncertain'
              }
            }
          } finally {
            processedBatches++
            report(scan.chat.title)
          }

          if (terminalStatus) break
        }

        settle({
          peerId,
          status: terminalStatus ?? 'delivered',
          affected,
          error: terminalError,
        })
      }

      return { outcomes, requestedMessages }
    } finally {
      unsubscribeFloodWait()
    }
  }

  private async reconcileBatch(
    chat: ChatInfo,
    messageIds: number[],
    callbacks: TraceCallbacks,
    signal: AbortSignal,
  ): Promise<{ existingIds: number[] } | null> {
    try {
      const existingIds = await withRetry(
        () => this.gateway.trace.getExistingMessageIds(chat.id, messageIds),
        {
          maxRetries: READ_ATTEMPTS,
          signal,
          onFloodWait: (seconds) => this.reportExplicitFloodWait(seconds, callbacks, signal),
        },
      )
      return { existingIds }
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)), chat)
      return null
    }
  }

  private reportExplicitFloodWait(
    seconds: number,
    callbacks: TraceCallbacks,
    signal: AbortSignal,
  ): void {
    callbacks.onFloodWait?.(seconds)
    if (callbacks.onFloodWaitCountdown) {
      startFloodWaitCountdown(seconds, callbacks.onFloodWaitCountdown, signal)
    }
  }
}

export const deleteTraceService = new DeleteTraceService()
