/**
 * Rate limiting utilities for Telegram API operations
 *
 * Handles FloodWaitError and provides retry with exponential backoff.
 * Based on Python export_service.py and resend_service.py patterns.
 */

// Constants matching Python implementation
const MAX_RETRIES = 3
const RETRY_BACKOFF_BASE = 1000 // 1 second in ms

export interface RateLimitOptions {
  maxRetries?: number
  backoffBase?: number
  onRetry?: (attempt: number, waitMs: number, error: Error) => void
  onFloodWait?: (seconds: number) => void
  signal?: AbortSignal
}

export interface FloodWaitError extends Error {
  seconds: number
}

/**
 * Check if an error is a FloodWait error from GramJS
 */
export function isFloodWaitError(error: unknown): error is FloodWaitError {
  if (error instanceof Error) {
    // GramJS throws errors with errorMessage property
    const gramError = error as Error & { errorMessage?: string; seconds?: number }

    // Check for FLOOD_WAIT pattern
    if (gramError.errorMessage?.startsWith('FLOOD_WAIT_')) {
      // Extract seconds from error message like "FLOOD_WAIT_420"
      const match = gramError.errorMessage.match(/FLOOD_WAIT_(\d+)/)
      if (match && match[1]) {
        ;(error as FloodWaitError).seconds = parseInt(match[1], 10)
        return true
      }
    }

    // Some GramJS versions include seconds directly
    if (typeof gramError.seconds === 'number' && gramError.seconds > 0) {
      return true
    }

    // Check message content
    if (error.message?.toLowerCase().includes('flood')) {
      // Try to extract seconds from message
      const match = error.message.match(/(\d+)\s*second/i)
      if (match && match[1]) {
        ;(error as FloodWaitError).seconds = parseInt(match[1], 10)
        return true
      }
      // Default to 60 seconds if we can't parse
      ;(error as FloodWaitError).seconds = 60
      return true
    }
  }
  return false
}

/**
 * Sleep for specified milliseconds with abort support
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

/**
 * Execute an async operation with retry logic and FloodWait handling
 *
 * @param operation - The async operation to execute
 * @param options - Retry options
 * @returns The result of the operation
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RateLimitOptions = {}
): Promise<T> {
  const {
    maxRetries = MAX_RETRIES,
    backoffBase = RETRY_BACKOFF_BASE,
    onRetry,
    onFloodWait,
    signal,
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Check for abort before each attempt
    if (signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError')
    }

    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Handle FloodWait specifically
      if (isFloodWaitError(error)) {
        const waitSeconds = error.seconds
        const waitMs = waitSeconds * 1000

        onFloodWait?.(waitSeconds)

        if (attempt < maxRetries - 1) {
          onRetry?.(attempt + 1, waitMs, lastError)
          await sleep(waitMs, signal)
          continue
        }
      } else {
        // For non-FloodWait errors, use exponential backoff
        if (attempt < maxRetries - 1) {
          const waitMs = backoffBase * Math.pow(2, attempt)
          onRetry?.(attempt + 1, waitMs, lastError)
          await sleep(waitMs, signal)
          continue
        }
      }
    }
  }

  throw lastError || new Error('Operation failed after retries')
}

/**
 * Semaphore for limiting concurrent operations
 * Used for parallel media downloads
 */
export class Semaphore {
  private permits: number
  private waitQueue: Array<() => void> = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }

    return new Promise((resolve) => {
      this.waitQueue.push(resolve)
    })
  }

  release(): void {
    const next = this.waitQueue.shift()
    if (next) {
      next()
    } else {
      this.permits++
    }
  }

  /**
   * Execute operation with semaphore
   */
  async withPermit<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await operation()
    } finally {
      this.release()
    }
  }
}

/**
 * Create a rate-limited version of an async function
 */
export function rateLimited<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  options: RateLimitOptions = {}
): T {
  return ((...args: Parameters<T>) => withRetry(() => fn(...args), options)) as T
}

/**
 * Progress tracker for long-running operations
 */
export interface OperationProgress {
  total: number
  processed: number
  failed: number
  currentItem?: string | number
  phase?: string
  startTime: Date
  estimatedTotalMs?: number
}

export function calculateETA(progress: OperationProgress): number | null {
  if (progress.processed === 0) return null

  const elapsedMs = Date.now() - progress.startTime.getTime()
  const avgTimePerItem = elapsedMs / progress.processed
  const remaining = progress.total - progress.processed

  return remaining * avgTimePerItem
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}
