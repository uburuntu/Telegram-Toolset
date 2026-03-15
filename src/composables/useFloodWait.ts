/**
 * Composable for flood wait state management
 *
 * Provides reactive state and handlers for Telegram FloodWait errors.
 * Reusable across all views that perform Telegram API operations.
 */

import { type ComputedRef, computed, type Ref, ref } from 'vue'

export interface FloodWaitState {
  /** Total wait time in seconds when flood wait started */
  seconds: Ref<number>
  /** Remaining seconds in countdown */
  remaining: Ref<number>
  /** Whether currently in a flood wait state */
  isWaiting: ComputedRef<boolean>
  /** Progress percentage (0-100) for progress bar */
  progress: ComputedRef<number>
  /** Reset flood wait state */
  reset: () => void
  /** Callbacks object ready to spread into service calls */
  callbacks: {
    onFloodWait: (seconds: number) => void
    onFloodWaitCountdown: (remaining: number) => void
  }
}

/**
 * Composable for managing flood wait UI state
 *
 * @example
 * ```typescript
 * const floodWait = useFloodWait()
 *
 * // Pass callbacks to service
 * await someService.doOperation(options, {
 *   ...floodWait.callbacks,
 *   onProgress: (p) => { ... }
 * })
 *
 * // In template
 * <FloodWaitIndicator
 *   :seconds="floodWait.seconds.value"
 *   :remaining="floodWait.remaining.value"
 *   :progress="floodWait.progress.value"
 * />
 *
 * // Reset when starting new operation
 * floodWait.reset()
 * ```
 */
export function useFloodWait(): FloodWaitState {
  const seconds = ref(0)
  const remaining = ref(0)

  const isWaiting = computed(() => seconds.value > 0)

  const progress = computed(() =>
    seconds.value > 0 ? ((seconds.value - remaining.value) / seconds.value) * 100 : 0,
  )

  function onFloodWait(waitSeconds: number) {
    seconds.value = waitSeconds
    remaining.value = waitSeconds
  }

  function onFloodWaitCountdown(remainingSeconds: number) {
    remaining.value = remainingSeconds
    if (remainingSeconds === 0) {
      seconds.value = 0
    }
  }

  function reset() {
    seconds.value = 0
    remaining.value = 0
  }

  const callbacks = {
    onFloodWait,
    onFloodWaitCountdown,
  }

  return {
    seconds,
    remaining,
    isWaiting,
    progress,
    reset,
    callbacks,
  }
}
