<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { telegramAuthGateway } from '@/services/telegram/gateway'
import { startFloodWaitCountdown } from '@/services/telegram/rate-limiter'
import { useAccountsStore } from '@/stores'
import type { ConnectionState } from '@/types'

const { t } = useI18n()
const accountsStore = useAccountsStore()

const connectionState = ref<ConnectionState>(telegramAuthGateway.connectionState ?? 'disconnected')
const floodWaitRemaining = ref(0)
const isRetrying = ref(false)

let unsubscribeConnection: (() => void) | undefined
let unsubscribeFloodWait: (() => void) | undefined
let floodWaitController: AbortController | undefined

const accountName = computed(
  () =>
    accountsStore.activeAccount?.firstName ||
    accountsStore.activeAccount?.label ||
    t('accounts.userAccount'),
)

const status = computed<'connecting' | 'reconnecting' | 'rateLimited' | 'error' | null>(() => {
  if (floodWaitRemaining.value > 0) return 'rateLimited'
  if (connectionState.value === 'error') return 'error'
  if (connectionState.value === 'reconnecting') return 'reconnecting'
  if (connectionState.value === 'connecting') return 'connecting'
  return null
})

const isVisible = computed(
  () =>
    accountsStore.activeAccount?.type === 'user' &&
    !accountsStore.activeAccountNeedsLogin &&
    status.value !== null,
)

const message = computed(() => {
  if (status.value === 'rateLimited') {
    return t('connectionStatus.rateLimited', { seconds: floodWaitRemaining.value })
  }
  if (status.value === 'connecting') {
    return t('connectionStatus.connecting', { name: accountName.value })
  }
  if (status.value === 'reconnecting') {
    return t('connectionStatus.reconnecting', { name: accountName.value })
  }
  if (status.value === 'error') {
    return t('connectionStatus.error', { name: accountName.value })
  }
  return ''
})

const canRetry = computed(() => {
  if (status.value !== 'error' || isRetrying.value) return false
  try {
    return telegramAuthGateway.canManualReconnect()
  } catch {
    return false
  }
})

function handleFloodWait(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return

  floodWaitController?.abort()
  floodWaitController = new AbortController()
  floodWaitRemaining.value = Math.ceil(seconds)
  startFloodWaitCountdown(
    floodWaitRemaining.value,
    (remaining) => {
      floodWaitRemaining.value = remaining
    },
    floodWaitController.signal,
  )
}

async function reconnect(): Promise<void> {
  if (!canRetry.value) return

  isRetrying.value = true
  try {
    await telegramAuthGateway.manualReconnect()
  } catch {
    // The gateway publishes the resulting error state; the band stays available for another retry.
  } finally {
    isRetrying.value = false
  }
}

onMounted(() => {
  try {
    unsubscribeConnection = telegramAuthGateway.onConnectionStateChange((state) => {
      connectionState.value = state
    })
  } catch {
    // Lightweight test facades may omit lifecycle subscriptions.
  }

  try {
    unsubscribeFloodWait = telegramAuthGateway.onFloodWait((seconds) => {
      handleFloodWait(seconds)
    })
  } catch {
    // Lightweight test facades may omit lifecycle subscriptions.
  }
})

onUnmounted(() => {
  unsubscribeConnection?.()
  unsubscribeFloodWait?.()
  floodWaitController?.abort()
})
</script>

<template>
  <section
    v-if="isVisible"
    :role="status === 'error' ? 'alert' : 'status'"
    aria-live="polite"
    :class="[
      'border-b',
      status === 'error'
        ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
        : status === 'rateLimited'
          ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
          : 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40',
    ]"
  >
    <div class="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
      <p
        :class="[
          'min-w-0 text-sm',
          status === 'error'
            ? 'text-red-800 dark:text-red-200'
            : status === 'rateLimited'
              ? 'text-amber-800 dark:text-amber-200'
              : 'text-blue-800 dark:text-blue-200',
        ]"
      >
        {{ message }}
      </p>
      <button
        v-if="status === 'error'"
        type="button"
        :disabled="!canRetry"
        class="shrink-0 px-3 py-1.5 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors duration-100"
        @click="reconnect"
      >
        {{ isRetrying ? t('connectionStatus.retrying') : t('connectionStatus.retry') }}
      </button>
    </div>
  </section>
</template>
