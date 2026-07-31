<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FloodWaitIndicator from '@/components/common/FloodWaitIndicator.vue'
import ChatSelector from '@/components/telegram/ChatSelector.vue'
import type { ChatSelectorConfig } from '@/components/telegram/chat-selector'
import { useFloodWait } from '@/composables'
import {
  deleteTraceService,
  type TraceChatScan,
  type TraceDeleteProgress,
  type TraceDeletionResult,
  type TraceScanProgress,
  type TraceScanResult,
} from '@/services/delete-trace/delete-trace-service'
import { createJobContext } from '@/services/jobs/job-context'
import { cancelJob, runJob } from '@/services/jobs/job-runner'
import { telegramGateway } from '@/services/telegram/gateway'
import { withRetry } from '@/services/telegram/rate-limiter'
import { sessionCoordinator } from '@/services/telegram/session-coordinator-instance'
import { useAccountsStore, useUiStore } from '@/stores'
import {
  type ChatInfo,
  type DeliveryOutcome,
  summarizeMultiPeerResult,
  type TelegramPrincipal,
} from '@/types'
import { parseDateInputBoundary } from '@/utils/date-input'
import { toUserFriendlyError } from '@/utils/error-messages'
import { formatDateWithLocale, formatNumberWithLocale } from '@/utils/locale-format'

const DELETE_MESSAGES_CHAT_SELECTOR_CONFIG: ChatSelectorConfig = {
  mode: 'multiple',
  filters: { sendableOnly: false },
  display: {
    maxHeight: 'lg',
    density: 'comfortable',
  },
  sortOptions: ['recent', 'name', 'type', 'members'],
}

type Step = 'select' | 'configure' | 'scanning' | 'review' | 'deleting' | 'complete'

const { t } = useI18n()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()
const floodWait = useFloodWait()

const step = ref<Step>('select')
const chats = ref<ChatInfo[]>([])
const selectedChatIds = ref<Set<string>>(new Set())
const isLoadingChats = ref(false)
const fromDate = ref('')
const throughDate = ref('')
const error = ref('')
const scanProgress = ref<TraceScanProgress | null>(null)
const scanResult = ref<TraceScanResult | null>(null)
const deleteProgress = ref<TraceDeleteProgress | null>(null)
const deletionResult = ref<TraceDeletionResult | null>(null)
const deletionConfirmed = ref(false)
const isCancellingDeletion = ref(false)
const activeDeleteOperationId = ref<string | null>(null)

let chatsRequestId = 0
let scanController: AbortController | null = null
let viewMounted = true

const selectedChats = computed(() =>
  chats.value.filter((chat) => selectedChatIds.value.has(chat.id.toString())),
)

const successfulScans = computed(
  () => scanResult.value?.chats.filter((chat) => !chat.error && chat.messageIds.length > 0) ?? [],
)

const scanPercentage = computed(() => {
  const progress = scanProgress.value
  if (!progress || progress.totalChats === 0) return 0
  return Math.round((progress.processedChats / progress.totalChats) * 100)
})

const deletionPercentage = computed(() => {
  const progress = deleteProgress.value
  if (!progress || progress.totalBatches === 0) return 0
  return Math.round((progress.processedBatches / progress.totalBatches) * 100)
})

const deletionSummary = computed(() =>
  deletionResult.value ? summarizeMultiPeerResult(deletionResult.value) : null,
)

const outcomeRows = computed(() => {
  const result = deletionResult.value
  if (!result) return []
  const chatById = new Map(
    (scanResult.value?.chats ?? []).map((item) => [item.chat.id.toString(), item.chat]),
  )
  return result.outcomes.map((outcome) => ({
    ...outcome,
    title: chatById.get(outcome.peerId)?.title ?? outcome.peerId,
  }))
})

function resetWorkflow(): void {
  step.value = 'select'
  selectedChatIds.value = new Set()
  fromDate.value = ''
  throughDate.value = ''
  error.value = ''
  scanProgress.value = null
  scanResult.value = null
  deleteProgress.value = null
  deletionResult.value = null
  deletionConfirmed.value = false
  isCancellingDeletion.value = false
  floodWait.reset()
}

watch(
  () => accountsStore.activeAccountId,
  async () => {
    chatsRequestId++
    scanController?.abort()
    scanController = null
    if (activeDeleteOperationId.value) {
      cancelJob(activeDeleteOperationId.value)
    }
    activeDeleteOperationId.value = null
    chats.value = []
    resetWorkflow()

    if (accountsStore.activeAccount?.type === 'user') {
      await loadChats()
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  viewMounted = false
  chatsRequestId++
  scanController?.abort()
})

async function loadChats(): Promise<void> {
  const requestId = ++chatsRequestId
  const accountId = accountsStore.activeAccountId
  isLoadingChats.value = true
  error.value = ''

  try {
    const loaded = await withRetry(() => telegramGateway.dialogs.getDialogs(), { maxRetries: 3 })
    if (requestId !== chatsRequestId || accountsStore.activeAccountId !== accountId) return
    chats.value = loaded
  } catch (loadError) {
    if (requestId !== chatsRequestId || accountsStore.activeAccountId !== accountId) return
    error.value = t('deleteTrace.loadError')
  } finally {
    if (requestId === chatsRequestId && accountsStore.activeAccountId === accountId) {
      isLoadingChats.value = false
    }
  }
}

function toggleChat(chat: ChatInfo): void {
  const next = new Set(selectedChatIds.value)
  const id = chat.id.toString()
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedChatIds.value = next
}

function setVisibleChats(visibleChats: ChatInfo[], selected: boolean): void {
  const next = new Set(selectedChatIds.value)
  for (const chat of visibleChats) {
    const id = chat.id.toString()
    if (selected) next.add(id)
    else next.delete(id)
  }
  selectedChatIds.value = next
}

function openConfiguration(): void {
  if (selectedChats.value.length === 0) return
  error.value = ''
  step.value = 'configure'
}

function dateRange(): { minDate?: Date; maxDate?: Date } | null {
  const minDate = parseDateInputBoundary(fromDate.value, 'start')
  const maxDate = parseDateInputBoundary(throughDate.value, 'end')
  if (minDate && maxDate && minDate > maxDate) {
    error.value = t('deleteTrace.invalidDateRange')
    return null
  }
  return { minDate, maxDate }
}

async function startScan(): Promise<void> {
  const chatsToScan = [...selectedChats.value]
  const range = dateRange()
  const accountId = accountsStore.activeAccountId
  if (chatsToScan.length === 0 || !range || !accountId) return

  scanController?.abort()
  const controller = new AbortController()
  scanController = controller
  step.value = 'scanning'
  error.value = ''
  scanProgress.value = null
  scanResult.value = null
  deletionConfirmed.value = false
  floodWait.reset()

  try {
    const result = await deleteTraceService.scan(
      chatsToScan,
      range,
      {
        onProgress: (progress) => {
          if (scanController === controller && accountsStore.activeAccountId === accountId) {
            scanProgress.value = progress
          }
        },
        ...floodWait.callbacks,
      },
      controller.signal,
    )
    if (scanController !== controller || accountsStore.activeAccountId !== accountId) return
    scanResult.value = result
    step.value = 'review'
  } catch (scanError) {
    if (scanController !== controller || accountsStore.activeAccountId !== accountId) return
    if (controller.signal.aborted) {
      step.value = 'configure'
      uiStore.showToast('info', t('deleteTrace.scanCancelled'))
    } else {
      error.value = toUserFriendlyError(scanError).message
      step.value = 'configure'
    }
  } finally {
    if (scanController === controller) {
      scanController = null
      floodWait.reset()
    }
  }
}

function cancelScan(): void {
  scanController?.abort()
}

function jobPrincipal(): TelegramPrincipal | null {
  const account = accountsStore.activeAccount
  if (account?.type !== 'user') return null
  if (account.principal?.kind === 'user') return account.principal
  const user = telegramGateway.auth.user
  return user ? { kind: 'user', telegramUserId: user.id.toString() } : null
}

function isSameJobOwner(accountId: string, generation: number, accountEpoch: number): boolean {
  return (
    viewMounted &&
    accountsStore.activeAccountId === accountId &&
    sessionCoordinator.getSnapshot().generation === generation &&
    accountsStore.getAccountEpoch(accountId) === accountEpoch
  )
}

async function startDeletion(): Promise<void> {
  const scans: TraceChatScan[] = successfulScans.value
  const account = accountsStore.activeAccount
  const principal = jobPrincipal()
  if (
    scans.length === 0 ||
    !scanResult.value?.totalMessages ||
    account?.type !== 'user' ||
    !principal ||
    !deletionConfirmed.value
  ) {
    if (!principal) error.value = t('deleteTrace.sessionNotReady')
    return
  }

  const sessionGeneration = sessionCoordinator.getSnapshot().generation
  const accountEpoch = accountsStore.getAccountEpoch(account.id)
  const { context, controller } = createJobContext({
    accountId: account.id,
    principal,
    sessionGeneration,
    accountEpoch,
  })

  activeDeleteOperationId.value = context.operationId
  step.value = 'deleting'
  error.value = ''
  deleteProgress.value = null
  deletionResult.value = null
  isCancellingDeletion.value = false
  floodWait.reset()

  try {
    const result = await runJob({
      context,
      controller,
      kind: 'trace-delete',
      title: t('deleteTrace.jobDeleteTitle'),
      execute: ({ signal, onProgress }) =>
        deleteTraceService.delete(
          scans,
          {
            onProgress: (progress) => {
              onProgress({
                current: progress.processedBatches,
                total: progress.totalBatches,
                label: progress.currentChat,
              })
              if (isSameJobOwner(account.id, sessionGeneration, accountEpoch)) {
                deleteProgress.value = progress
              }
            },
            ...floodWait.callbacks,
          },
          signal,
        ),
    })

    if (!isSameJobOwner(account.id, sessionGeneration, accountEpoch)) return
    deletionResult.value = result
    step.value = 'complete'
  } catch (deleteError) {
    if (!isSameJobOwner(account.id, sessionGeneration, accountEpoch)) return
    error.value = toUserFriendlyError(deleteError).message
    step.value = 'review'
  } finally {
    if (activeDeleteOperationId.value === context.operationId) {
      activeDeleteOperationId.value = null
      isCancellingDeletion.value = false
      floodWait.reset()
    }
  }
}

function cancelDeletion(): void {
  if (!activeDeleteOperationId.value) return
  isCancellingDeletion.value = true
  cancelJob(activeDeleteOperationId.value)
}

function restart(): void {
  scanResult.value = null
  deletionResult.value = null
  deleteProgress.value = null
  deletionConfirmed.value = false
  error.value = ''
  step.value = 'select'
}

function formatDate(date?: Date): string {
  return date
    ? formatDateWithLocale(date, { year: 'numeric', month: 'short', day: 'numeric' })
    : t('deleteTrace.allDates')
}

function formatCount(value: number): string {
  return formatNumberWithLocale(value)
}

function outcomeLabel(status: DeliveryOutcome): string {
  return t(`deleteTrace.outcome.${status}`)
}

function outcomeClass(status: DeliveryOutcome): string {
  switch (status) {
    case 'delivered':
      return 'text-green-700 dark:text-green-400'
    case 'failed':
      return 'text-red-700 dark:text-red-400'
    case 'skipped':
      return 'text-gray-600 dark:text-gray-400'
    case 'delivery_uncertain':
    case 'abandoned':
      return 'text-amber-700 dark:text-amber-400'
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {{ t('deleteTrace.title') }}
      </h1>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('deleteTrace.description') }}
      </p>
    </header>

    <div
      v-if="error"
      class="mb-5 p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-sm text-red-800 dark:text-red-300"
      role="alert"
    >
      {{ error }}
    </div>

    <template v-if="step === 'select'">
      <ChatSelector
        input-id="delete-trace-chat-search"
        :chats="chats"
        :selected-ids="selectedChatIds"
        :is-loading="isLoadingChats"
        :config="DELETE_MESSAGES_CHAT_SELECTOR_CONFIG"
        :labels="{
          title: t('deleteTrace.selectChats'),
          searchPlaceholder: t('deleteTrace.searchChats'),
          loading: t('deleteTrace.loadingChats'),
          emptyTitle: t('deleteTrace.noChats'),
          noResults: t('deleteTrace.noSearchResults'),
        }"
        @toggle="toggleChat"
        @set-visible="setVisibleChats"
      />
      <div class="mt-5 flex justify-end">
        <button
          type="button"
          :disabled="selectedChats.length === 0 || isLoadingChats"
          class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors duration-100"
          @click="openConfiguration"
        >
          {{ t('common.next') }}
        </button>
      </div>
    </template>

    <template v-else-if="step === 'configure'">
      <button
        type="button"
        class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4 transition-colors duration-100"
        @click="step = 'select'"
      >
        ← {{ t('common.back') }}
      </button>

      <section class="space-y-5">
        <div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ t('deleteTrace.dateRange') }}
          </h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {{ t('deleteTrace.dateRangeDescription') }}
          </p>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              for="delete-trace-from-date"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {{ t('deleteTrace.fromDate') }}
            </label>
            <input
              id="delete-trace-from-date"
              v-model="fromDate"
              type="date"
              class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
            />
          </div>
          <div>
            <label
              for="delete-trace-through-date"
              class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {{ t('deleteTrace.throughDate') }}
            </label>
            <input
              id="delete-trace-through-date"
              v-model="throughDate"
              type="date"
              class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
            />
          </div>
        </div>

        <div class="border-y border-gray-200 dark:border-gray-800 py-4">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            {{ t('deleteTrace.selectedChats') }}
          </h3>
          <ul class="space-y-1 text-sm text-gray-600 dark:text-gray-400">
            <li v-for="chat in selectedChats" :key="chat.id.toString()" class="break-words">
              {{ chat.title }}
            </li>
          </ul>
        </div>

        <div class="flex justify-end">
          <button
            type="button"
            class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
            @click="startScan"
          >
            {{ t('deleteTrace.scan') }}
          </button>
        </div>
      </section>
    </template>

    <template v-else-if="step === 'scanning'">
      <section class="py-8" aria-live="polite">
        <div
          class="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
        ></div>
        <h2 class="text-lg font-semibold text-center text-gray-900 dark:text-white">
          {{ t('deleteTrace.scanning') }}
        </h2>
        <p class="mt-2 text-sm text-center text-gray-600 dark:text-gray-400 break-words">
          {{ scanProgress?.currentChat || t('deleteTrace.preparingScan') }}
        </p>

        <div class="mt-5 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800">
          <div
            class="h-2 rounded-full bg-blue-600 transition-all duration-100 ease-out"
            :style="{ width: `${scanPercentage}%` }"
          ></div>
        </div>
        <div class="mt-2 flex flex-wrap justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>
            {{
              t('deleteTrace.scanProgress', {
                current: scanProgress?.processedChats || 0,
                total: scanProgress?.totalChats || selectedChats.length,
              })
            }}
          </span>
          <span>{{ t('deleteTrace.scanFound', { count: scanProgress?.foundMessages || 0 }) }}</span>
        </div>

        <div class="mt-4">
          <FloodWaitIndicator
            :seconds="floodWait.seconds.value"
            :remaining="floodWait.remaining.value"
            :progress="floodWait.progress.value"
          />
        </div>

        <div class="mt-5 flex justify-center">
          <button
            type="button"
            class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-100"
            @click="cancelScan"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </section>
    </template>

    <template v-else-if="step === 'review' && scanResult">
      <button
        type="button"
        class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4 transition-colors duration-100"
        @click="step = 'configure'"
      >
        ← {{ t('common.back') }}
      </button>

      <section class="space-y-5">
        <div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ t('deleteTrace.reviewTitle') }}
          </h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {{
              t('deleteTrace.reviewDescription', {
                count: formatCount(scanResult.totalMessages),
                chats: successfulScans.length,
              })
            }}
          </p>
        </div>

        <ul class="divide-y divide-gray-200 dark:divide-gray-800 border-y border-gray-200 dark:border-gray-800">
          <li v-for="item in scanResult.chats" :key="item.chat.id.toString()" class="py-3">
            <div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0">
                <p class="text-sm font-medium text-gray-900 dark:text-white break-words">
                  {{ item.chat.title }}
                </p>
                <p v-if="!item.error" class="text-xs text-gray-500 dark:text-gray-400">
                  {{ formatDate(item.oldestDate) }} – {{ formatDate(item.newestDate) }}
                </p>
                <p v-else class="text-xs text-red-600 dark:text-red-400 break-words">
                  {{ t('deleteTrace.scanFailed') }}
                </p>
              </div>
              <span v-if="!item.error" class="text-sm font-medium text-gray-700 dark:text-gray-300">
                {{ t('deleteTrace.messagesFound', { count: formatCount(item.messageIds.length) }) }}
              </span>
            </div>
          </li>
        </ul>

        <div
          class="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg"
        >
          <p class="text-sm text-amber-900 dark:text-amber-200">
            {{ t('deleteTrace.identityNotice') }}
          </p>
        </div>

        <div v-if="scanResult.totalMessages === 0" class="py-6 text-center">
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('deleteTrace.noMessages') }}
          </p>
        </div>

        <template v-else>
          <div
            class="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg"
          >
            <p class="text-sm font-medium text-red-900 dark:text-red-200">
              {{ t('deleteTrace.deleteWarning') }}
            </p>
            <label class="mt-3 flex items-start gap-2 text-sm text-red-900 dark:text-red-200">
              <input
                v-model="deletionConfirmed"
                type="checkbox"
                class="mt-0.5 rounded text-red-600 focus:ring-red-500"
              />
              <span>
                {{ t('deleteTrace.confirmDeletion', { count: formatCount(scanResult.totalMessages) }) }}
              </span>
            </label>
          </div>

          <div class="flex justify-end">
            <button
              type="button"
              :disabled="!deletionConfirmed"
              class="px-4 py-2 rounded-md font-medium text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors duration-100"
              @click="startDeletion"
            >
              {{ t('deleteTrace.deleteAction', { count: formatCount(scanResult.totalMessages) }) }}
            </button>
          </div>
        </template>
      </section>
    </template>

    <template v-else-if="step === 'deleting'">
      <section class="py-8" aria-live="polite">
        <h2 class="text-lg font-semibold text-center text-gray-900 dark:text-white">
          {{ isCancellingDeletion ? t('deleteTrace.cancelling') : t('deleteTrace.deleting') }}
        </h2>
        <p class="mt-2 text-sm text-center text-gray-600 dark:text-gray-400 break-words">
          {{ deleteProgress?.currentChat || t('deleteTrace.preparingDeletion') }}
        </p>

        <div class="mt-5 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-800">
          <div
            class="h-2 rounded-full bg-red-600 transition-all duration-100 ease-out"
            :style="{ width: `${deletionPercentage}%` }"
          ></div>
        </div>
        <div class="mt-2 flex flex-wrap justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>
            {{
              t('deleteTrace.deleteProgress', {
                current: deleteProgress?.processedBatches || 0,
                total: deleteProgress?.totalBatches || 0,
              })
            }}
          </span>
          <span>
            {{
              t('deleteTrace.confirmedDeleted', {
                count: formatCount(deleteProgress?.confirmedMessages || 0),
              })
            }}
          </span>
        </div>

        <div class="mt-4">
          <FloodWaitIndicator
            :seconds="floodWait.seconds.value"
            :remaining="floodWait.remaining.value"
            :progress="floodWait.progress.value"
          />
        </div>

        <div class="mt-5 flex justify-center">
          <button
            type="button"
            :disabled="isCancellingDeletion"
            class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors duration-100"
            @click="cancelDeletion"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </section>
    </template>

    <template v-else-if="step === 'complete' && deletionResult && deletionSummary">
      <section class="space-y-5">
        <div>
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
            {{ t('deleteTrace.completeTitle') }}
          </h2>
          <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {{
              t('deleteTrace.completeSummary', {
                count: formatCount(deletionSummary.affected),
                total: formatCount(deletionResult.requestedMessages),
              })
            }}
          </p>
        </div>

        <div
          v-if="deletionSummary.uncertain > 0"
          class="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg text-sm text-amber-900 dark:text-amber-200"
        >
          {{ t('deleteTrace.uncertainNotice') }}
        </div>

        <ul class="divide-y divide-gray-200 dark:divide-gray-800 border-y border-gray-200 dark:border-gray-800">
          <li
            v-for="outcome in outcomeRows"
            :key="outcome.peerId"
            class="py-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-900 dark:text-white break-words">
                {{ outcome.title }}
              </p>
              <p v-if="outcome.error" class="text-xs text-gray-500 dark:text-gray-400 break-words">
                {{ outcome.error }}
              </p>
            </div>
            <div class="text-sm sm:text-left">
              <p class="font-medium" :class="outcomeClass(outcome.status)">
                {{ outcomeLabel(outcome.status) }}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ t('deleteTrace.deletedCount', { count: formatCount(outcome.affected || 0) }) }}
              </p>
            </div>
          </li>
        </ul>

        <div class="flex justify-end">
          <button
            type="button"
            class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
            @click="restart"
          >
            {{ t('deleteTrace.scanAgain') }}
          </button>
        </div>
      </section>
    </template>
  </div>
</template>
