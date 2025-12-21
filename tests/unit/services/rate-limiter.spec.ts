import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  Semaphore,
  withRetry,
  isFloodWaitError,
  sleep,
  formatDuration,
  calculateETA,
  type FloodWaitError,
  type OperationProgress,
} from '@/services/telegram/rate-limiter'

describe('rate-limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('sleep', () => {
    it('should resolve after specified time', async () => {
      const sleepPromise = sleep(1000)
      vi.advanceTimersByTime(1000)
      await expect(sleepPromise).resolves.toBeUndefined()
    })

    it('should reject immediately if signal already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      await expect(sleep(1000, controller.signal)).rejects.toThrow('Aborted')
    })

    it('should reject when signal is aborted during sleep', async () => {
      const controller = new AbortController()
      const sleepPromise = sleep(5000, controller.signal)

      // Advance partway then abort
      vi.advanceTimersByTime(2000)
      controller.abort()

      await expect(sleepPromise).rejects.toThrow('Aborted')
    })
  })

  describe('isFloodWaitError', () => {
    it('should return false for non-Error values', () => {
      expect(isFloodWaitError(null)).toBe(false)
      expect(isFloodWaitError(undefined)).toBe(false)
      expect(isFloodWaitError('string')).toBe(false)
      expect(isFloodWaitError(123)).toBe(false)
    })

    it('should return false for regular errors', () => {
      expect(isFloodWaitError(new Error('Network error'))).toBe(false)
    })

    it('should detect FLOOD_WAIT_X pattern in errorMessage', () => {
      const error = new Error('Flood wait') as FloodWaitError & { errorMessage: string }
      error.errorMessage = 'FLOOD_WAIT_420'

      expect(isFloodWaitError(error)).toBe(true)
      expect(error.seconds).toBe(420)
    })

    it('should detect seconds property', () => {
      const error = new Error('Flood error') as FloodWaitError
      error.seconds = 60

      expect(isFloodWaitError(error)).toBe(true)
    })

    it('should detect flood in message content', () => {
      const error = new Error('Please wait 30 seconds before retrying (flood)') as FloodWaitError

      expect(isFloodWaitError(error)).toBe(true)
      expect(error.seconds).toBe(30)
    })

    it('should default to 60 seconds when flood detected but no seconds found', () => {
      const error = new Error('flood limit reached') as FloodWaitError

      expect(isFloodWaitError(error)).toBe(true)
      expect(error.seconds).toBe(60)
    })
  })

  describe('formatDuration', () => {
    it('should format seconds only', () => {
      expect(formatDuration(5000)).toBe('5s')
      expect(formatDuration(59000)).toBe('59s')
    })

    it('should format minutes and seconds', () => {
      expect(formatDuration(60000)).toBe('1m 0s')
      expect(formatDuration(90000)).toBe('1m 30s')
      expect(formatDuration(3599000)).toBe('59m 59s')
    })

    it('should format hours, minutes, and seconds', () => {
      expect(formatDuration(3600000)).toBe('1h 0m 0s')
      expect(formatDuration(3661000)).toBe('1h 1m 1s')
      expect(formatDuration(7265000)).toBe('2h 1m 5s')
    })
  })

  describe('calculateETA', () => {
    it('should return null when no items processed', () => {
      const progress: OperationProgress = {
        total: 100,
        processed: 0,
        failed: 0,
        startTime: new Date(),
      }

      expect(calculateETA(progress)).toBeNull()
    })

    it('should calculate remaining time based on average', () => {
      const startTime = new Date(Date.now() - 10000) // 10 seconds ago

      const progress: OperationProgress = {
        total: 100,
        processed: 50,
        failed: 0,
        startTime,
      }

      // 50 items in 10 seconds = 200ms per item
      // 50 remaining = 10000ms remaining
      const eta = calculateETA(progress)
      expect(eta).toBeCloseTo(10000, -2) // Allow some tolerance
    })
  })

  describe('Semaphore', () => {
    it('should allow operations up to permit limit', async () => {
      const semaphore = new Semaphore(2)
      const results: number[] = []

      // Start 2 operations - both should proceed immediately
      const p1 = semaphore.withPermit(async () => {
        results.push(1)
        return 1
      })

      const p2 = semaphore.withPermit(async () => {
        results.push(2)
        return 2
      })

      await Promise.all([p1, p2])

      expect(results).toContain(1)
      expect(results).toContain(2)
    })

    it('should queue operations when permits exhausted', async () => {
      vi.useRealTimers() // Need real timers for this test

      const semaphore = new Semaphore(1)
      const order: number[] = []

      const p1 = semaphore.withPermit(async () => {
        order.push(1)
        await new Promise((r) => setTimeout(r, 50))
        order.push(2)
        return 'first'
      })

      const p2 = semaphore.withPermit(async () => {
        order.push(3)
        return 'second'
      })

      await Promise.all([p1, p2])

      // p1 should start (1), complete (2), then p2 starts (3)
      expect(order).toEqual([1, 2, 3])
    })

    it('should release permit even on error', async () => {
      const semaphore = new Semaphore(1)

      // First operation fails
      await expect(
        semaphore.withPermit(async () => {
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')

      // Second operation should still be able to acquire
      const result = await semaphore.withPermit(async () => 'success')
      expect(result).toBe('success')
    })
  })

  describe('withRetry', () => {
    it('should return result on first success', async () => {
      const operation = vi.fn().mockResolvedValue('success')

      const result = await withRetry(operation)

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure and eventually succeed', async () => {
      vi.useRealTimers()

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValueOnce('success')

      const result = await withRetry(operation, { maxRetries: 3, backoffBase: 10 })

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('should throw last error after all retries exhausted', async () => {
      vi.useRealTimers()

      const operation = vi.fn().mockRejectedValue(new Error('Persistent error'))

      await expect(withRetry(operation, { maxRetries: 2, backoffBase: 10 })).rejects.toThrow(
        'Persistent error'
      )
      expect(operation).toHaveBeenCalledTimes(2)
    })

    it('should call onRetry callback on each retry', async () => {
      vi.useRealTimers()

      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('Retry me'))
        .mockResolvedValueOnce('ok')

      const onRetry = vi.fn()

      await withRetry(operation, { maxRetries: 2, backoffBase: 10, onRetry })

      expect(onRetry).toHaveBeenCalledTimes(1)
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Error))
    })

    it('should handle FloodWait errors with specific wait time', async () => {
      // Use short wait time (1 second) for testing
      const floodError = new Error('FLOOD_WAIT_1') as FloodWaitError & { errorMessage: string }
      floodError.errorMessage = 'FLOOD_WAIT_1'

      const operation = vi.fn().mockRejectedValueOnce(floodError).mockResolvedValueOnce('success')

      const onFloodWait = vi.fn()

      const resultPromise = withRetry(operation, {
        maxRetries: 2,
        onFloodWait,
      })

      // Advance timers to handle the flood wait
      await vi.advanceTimersByTimeAsync(1000)

      const result = await resultPromise

      expect(result).toBe('success')
      expect(onFloodWait).toHaveBeenCalledWith(1)
    })

    it('should abort immediately when signal is aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      const operation = vi.fn()

      await expect(withRetry(operation, { signal: controller.signal })).rejects.toThrow(
        'Operation cancelled'
      )
      expect(operation).not.toHaveBeenCalled()
    })
  })
})

