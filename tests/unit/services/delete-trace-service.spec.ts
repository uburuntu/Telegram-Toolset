import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DeleteTraceService,
  isRetryableTraceDeleteError,
  type TraceChatScan,
} from '@/services/delete-trace/delete-trace-service'
import type { ChatInfo } from '@/types'
import type {
  TelegramAuthSessionGateway,
  TelegramTraceGateway,
} from '@/services/telegram/gateway/contracts'

function chat(id: number, title = `Chat ${id}`): ChatInfo {
  return {
    id: BigInt(id),
    title,
    type: 'supergroup',
    canExport: false,
    canSend: true,
    isAdmin: false,
  }
}

function createService(overrides: Partial<TelegramTraceGateway> = {}) {
  const trace: TelegramTraceGateway = {
    searchOwnMessages: vi.fn().mockResolvedValue({ messages: [], total: 0 }),
    deleteMessages: vi.fn().mockResolvedValue(undefined),
    getExistingMessageIds: vi.fn().mockResolvedValue([]),
    ...overrides,
  }
  const unsubscribe = vi.fn()
  const auth = {
    onFloodWait: vi.fn(() => unsubscribe),
  } as unknown as TelegramAuthSessionGateway

  return {
    service: new DeleteTraceService({ auth, trace }),
    trace,
    auth,
    unsubscribe,
  }
}

function scan(chatInfo: ChatInfo, messageIds: number[]): TraceChatScan {
  return { chat: chatInfo, messageIds }
}

async function advanceRetryTimers<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync()
  return promise
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DeleteTraceService', () => {
  it('scans resumable sender-filtered pages without double-counting cursor overlap', async () => {
    const target = chat(10, 'Public chat')
    const { service, trace, unsubscribe } = createService({
      searchOwnMessages: vi
        .fn()
        .mockResolvedValueOnce({
          messages: [
            { id: 30, date: new Date('2024-03-01T00:00:00.000Z') },
            { id: 20, date: new Date('2023-03-01T00:00:00.000Z') },
          ],
          total: 3,
          nextOffsetId: 20,
        })
        .mockResolvedValueOnce({
          messages: [
            { id: 20, date: new Date('2023-03-01T00:00:00.000Z') },
            { id: 10, date: new Date('2022-03-01T00:00:00.000Z') },
          ],
          total: 3,
        }),
    })
    const onProgress = vi.fn()

    const result = await service.scan(
      [target],
      { maxDate: new Date('2024-12-31T23:59:59.999Z') },
      { onProgress },
    )

    expect(result).toEqual({
      chats: [
        {
          chat: target,
          messageIds: [30, 20, 10],
          oldestDate: new Date('2022-03-01T00:00:00.000Z'),
          newestDate: new Date('2024-03-01T00:00:00.000Z'),
        },
      ],
      totalMessages: 3,
      failedChats: 0,
    })
    expect(trace.searchOwnMessages).toHaveBeenNthCalledWith(
      1,
      target.id,
      expect.objectContaining({ offsetId: 0, limit: 100 }),
    )
    expect(trace.searchOwnMessages).toHaveBeenNthCalledWith(
      2,
      target.id,
      expect.objectContaining({ offsetId: 20, limit: 100 }),
    )
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ processedChats: 1, foundMessages: 3 }),
    )
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('discards an incomplete chat scan after its page retries are exhausted', async () => {
    vi.useFakeTimers()
    const target = chat(10)
    const searchOwnMessages = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [{ id: 30, date: new Date('2024-01-01T00:00:00.000Z') }],
        total: 2,
        nextOffsetId: 30,
      })
      .mockRejectedValue(new Error('network down'))
    const { service } = createService({ searchOwnMessages })
    const onError = vi.fn()

    const promise = service.scan([target], {}, { onError })
    const result = await advanceRetryTimers(promise)

    expect(result).toEqual({
      chats: [{ chat: target, messageIds: [], error: 'network down' }],
      totalMessages: 0,
      failedChats: 1,
    })
    expect(searchOwnMessages).toHaveBeenCalledTimes(5)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'network down' }), target)
  })

  it('deletes sequential batches of at most 100 IDs', async () => {
    const target = chat(10)
    const ids = Array.from({ length: 205 }, (_, index) => index + 1)
    const { service, trace } = createService()

    const result = await service.delete([scan(target, ids)])

    expect(trace.deleteMessages).toHaveBeenCalledTimes(3)
    expect(vi.mocked(trace.deleteMessages).mock.calls.map((call) => call[1].length)).toEqual([
      100, 100, 5,
    ])
    expect(result).toEqual({
      outcomes: [{ peerId: '10', status: 'delivered', affected: 205, error: undefined }],
      requestedMessages: 205,
    })
  })

  it('does not retry a permanent RPC rejection and continues with later chats', async () => {
    const first = chat(10)
    const second = chat(20)
    const forbidden = Object.assign(new Error('MESSAGE_DELETE_FORBIDDEN'), { code: 400 })
    const deleteMessages = vi
      .fn()
      .mockRejectedValueOnce(forbidden)
      .mockResolvedValueOnce(undefined)
    const { service, trace } = createService({ deleteMessages })

    const result = await service.delete([scan(first, [1]), scan(second, [2])])

    expect(trace.deleteMessages).toHaveBeenCalledTimes(2)
    expect(trace.getExistingMessageIds).not.toHaveBeenCalled()
    expect(result.outcomes).toEqual([
      { peerId: '10', status: 'failed', affected: 0, error: 'MESSAGE_DELETE_FORBIDDEN' },
      { peerId: '20', status: 'delivered', affected: 1, error: undefined },
    ])
  })

  it('retries an idempotent delete after a transient failure', async () => {
    vi.useFakeTimers()
    const deleteMessages = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket closed'))
      .mockResolvedValueOnce(undefined)
    const { service } = createService({ deleteMessages })

    const promise = service.delete([scan(chat(10), [1, 2])])
    const result = await advanceRetryTimers(promise)

    expect(deleteMessages).toHaveBeenCalledTimes(2)
    expect(result.outcomes[0]).toMatchObject({ status: 'delivered', affected: 2 })
  })

  it('reconciles an exhausted ambiguous delete before reporting its outcome', async () => {
    vi.useFakeTimers()
    const deleteMessages = vi.fn().mockRejectedValue(new Error('connection lost'))
    const getExistingMessageIds = vi.fn().mockResolvedValue([])
    const { service } = createService({ deleteMessages, getExistingMessageIds })

    const promise = service.delete([scan(chat(10), [1, 2])])
    const result = await advanceRetryTimers(promise)

    expect(deleteMessages).toHaveBeenCalledTimes(4)
    expect(getExistingMessageIds).toHaveBeenCalledWith(BigInt(10), [1, 2])
    expect(result.outcomes[0]).toMatchObject({ status: 'delivered', affected: 2 })
  })

  it('reports confirmed missing IDs and fails when reconciliation finds messages remaining', async () => {
    vi.useFakeTimers()
    const { service } = createService({
      deleteMessages: vi.fn().mockRejectedValue(new Error('connection lost')),
      getExistingMessageIds: vi.fn().mockResolvedValue([2]),
    })

    const promise = service.delete([scan(chat(10), [1, 2])])
    const result = await advanceRetryTimers(promise)

    expect(result.outcomes[0]).toMatchObject({
      status: 'failed',
      affected: 1,
      error: 'connection lost',
    })
  })

  it('classifies retryable and permanent deletion failures', () => {
    expect(isRetryableTraceDeleteError(new Error('network down'))).toBe(true)
    expect(isRetryableTraceDeleteError(Object.assign(new Error('server'), { code: 500 }))).toBe(true)
    expect(isRetryableTraceDeleteError(Object.assign(new Error('forbidden'), { code: 403 }))).toBe(
      false,
    )
  })
})
