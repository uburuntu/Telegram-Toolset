<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { exportService } from '@/services/export/export-service'
import { zipGenerator } from '@/services/export/zip-generator'
import { backupManager } from '@/services/storage/backup-manager'
import { quotaManager } from '@/services/storage/quota'
import { telegramService } from '@/services/telegram/client'
import { formatDuration } from '@/services/telegram/rate-limiter'
import { useBackupsStore, useUiStore } from '@/stores'
import type { BackupWithMessages, ChatInfo, ExportConfig, ExportProgress } from '@/types'
import { toUserFriendlyError } from '@/utils/error-messages'

const { t } = useI18n()
const router = useRouter()
const backupsStore = useBackupsStore()
const uiStore = useUiStore()

// State
const step = ref<'select-chat' | 'configure' | 'confirm' | 'exporting' | 'complete'>('select-chat')
const chats = ref<ChatInfo[]>([])
const searchQuery = ref('')
const selectedChat = ref<ChatInfo | null>(null)
const exportMode = ref<'all' | 'media_only' | 'text_only'>('all')
const downloadZipAfter = ref(false)
const isLoading = ref(false)
const error = ref('')
const isDownloadingZip = ref(false)

// Date preset options (values only, labels come from i18n)
const datePresets = ['custom', '7days', '30days', '90days', 'thisMonth', 'lastMonth'] as const
type DatePreset = (typeof datePresets)[number]

// Date range filtering
const useDateFilter = ref(false)
const datePreset = ref<DatePreset>('custom')
const minDate = ref('')
const maxDate = ref('')

// Apply date preset
function applyDatePreset(preset: (typeof datePresets)[number]) {
  datePreset.value = preset
  const now = new Date()

  switch (preset) {
    case '7days': {
      const sevenDaysAgo = new Date(now)
      sevenDaysAgo.setDate(now.getDate() - 7)
      minDate.value = sevenDaysAgo.toISOString().split('T')[0] || ''
      maxDate.value = now.toISOString().split('T')[0] || ''
      break
    }
    case '30days': {
      const thirtyDaysAgo = new Date(now)
      thirtyDaysAgo.setDate(now.getDate() - 30)
      minDate.value = thirtyDaysAgo.toISOString().split('T')[0] || ''
      maxDate.value = now.toISOString().split('T')[0] || ''
      break
    }
    case '90days': {
      const ninetyDaysAgo = new Date(now)
      ninetyDaysAgo.setDate(now.getDate() - 90)
      minDate.value = ninetyDaysAgo.toISOString().split('T')[0] || ''
      maxDate.value = now.toISOString().split('T')[0] || ''
      break
    }
    case 'thisMonth': {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      minDate.value = firstOfMonth.toISOString().split('T')[0] || ''
      maxDate.value = now.toISOString().split('T')[0] || ''
      break
    }
    case 'lastMonth': {
      const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const lastOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)
      minDate.value = firstOfLastMonth.toISOString().split('T')[0] || ''
      maxDate.value = lastOfLastMonth.toISOString().split('T')[0] || ''
      break
    }
    default:
      // Keep current values for custom
      break
  }
}

// Connection state for reconnect
const isReconnecting = ref(false)

// Progress tracking
const currentProgress = ref<ExportProgress | null>(null)
const floodWaitSeconds = ref(0)
const floodWaitRemaining = ref(0)

// Store last export result for ZIP download
const lastExportResult = ref<BackupWithMessages | null>(null)

// Computed
const filteredChats = computed(() => {
  const query = searchQuery.value.toLowerCase()
  return chats.value
    .filter((chat) => chat.canExport)
    .filter((chat) => chat.title.toLowerCase().includes(query))
})

const exportableChatsCount = computed(() => chats.value.filter((c) => c.canExport).length)

const progressPercentage = computed(() => {
  if (!currentProgress.value || currentProgress.value.totalMessages === 0) return 0
  return Math.round(
    (currentProgress.value.processedMessages / currentProgress.value.totalMessages) * 100,
  )
})

const estimatedTimeRemaining = computed(() => {
  if (!currentProgress.value || currentProgress.value.processedMessages === 0) return null

  const elapsed = Date.now() - currentProgress.value.startTime.getTime()
  const avgTimePerItem = elapsed / currentProgress.value.processedMessages
  const remaining = currentProgress.value.totalMessages - currentProgress.value.processedMessages

  return formatDuration(remaining * avgTimePerItem)
})

const phaseLabel = computed(() => {
  switch (currentProgress.value?.phase) {
    case 'fetching_metadata':
      return t('export.fetchingMessages')
    case 'downloading_media':
      return t('export.downloadingMedia')
    case 'saving':
      return t('export.savingStorage')
    case 'complete':
      return t('export.complete')
    case 'error':
      return t('export.errorOccurred')
    case 'cancelled':
      return t('export.cancelled')
    default:
      return t('export.processing')
  }
})

// Lifecycle
onMounted(async () => {
  isLoading.value = true
  try {
    chats.value = await telegramService.getDialogs(100)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load chats'
  } finally {
    isLoading.value = false
  }
})

onUnmounted(() => {
  // Cancel any in-progress export on unmount
  if (exportService.isExporting) {
    exportService.cancel()
  }
})

// Actions
function selectChat(chat: ChatInfo) {
  selectedChat.value = chat
  step.value = 'configure'
}

function goBack() {
  if (step.value === 'configure') {
    step.value = 'select-chat'
    selectedChat.value = null
  } else if (step.value === 'confirm') {
    step.value = 'configure'
  } else if (step.value === 'complete') {
    router.push('/backups')
  }
}

function showConfirmation() {
  step.value = 'confirm'
}

function confirmAndStart() {
  startExport()
}

function resetExport() {
  step.value = 'select-chat'
  selectedChat.value = null
  currentProgress.value = null
  floodWaitSeconds.value = 0
  error.value = ''
}

function cancelExport() {
  exportService.cancel()
}

async function handleManualReconnect() {
  isReconnecting.value = true
  error.value = ''

  try {
    await telegramService.manualReconnect()
    uiStore.showToast('success', 'Reconnected successfully!')

    // Go back to configure step to retry
    step.value = 'configure'
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to reconnect'
    error.value = message
    uiStore.showToast('error', message)
  } finally {
    isReconnecting.value = false
  }
}

async function startExport() {
  if (!selectedChat.value) return

  step.value = 'exporting'
  error.value = ''
  currentProgress.value = null
  floodWaitSeconds.value = 0

  const config: ExportConfig = {
    chatId: selectedChat.value.id,
    chatTitle: selectedChat.value.title,
    exportMode: exportMode.value,
    storageStrategy: 'indexeddb',
    // Date filters
    minDate: useDateFilter.value && minDate.value ? new Date(minDate.value) : undefined,
    maxDate:
      useDateFilter.value && maxDate.value
        ? new Date(`${maxDate.value}T23:59:59`) // Include the entire day
        : undefined,
  }

  // Check storage
  const strategy = await quotaManager.determineExportStrategy(100_000_000) // Estimate
  if (strategy.warnUser) {
    uiStore.showToast('warning', 'Large export detected. Consider downloading as ZIP.')
  }

  try {
    // Use the new ExportService with callbacks
    const result = await exportService.exportDeletedMessages(config, {
      onProgress: (progress) => {
        currentProgress.value = { ...progress }
        backupsStore.updateExportProgress({
          phase: progress.phase,
          processedMessages: progress.processedMessages,
          totalMessages: progress.totalMessages,
          exportedTextMessages: progress.exportedTextMessages,
          exportedMediaMessages: progress.exportedMediaMessages,
          failedMessages: progress.failedMessages,
          currentMessageId: progress.currentMessageId,
        })
      },
      onFloodWait: (seconds) => {
        floodWaitSeconds.value = seconds
        floodWaitRemaining.value = seconds
        uiStore.showToast('warning', `Rate limited. Waiting ${seconds} seconds...`)
      },
      onFloodWaitCountdown: (remaining) => {
        floodWaitRemaining.value = remaining
        if (remaining === 0) {
          floodWaitSeconds.value = 0
        }
      },
      onError: (err, messageId) => {
        console.error(`Failed to process message ${messageId}:`, err)
      },
    })

    // Create backup from results
    backupsStore.updateExportProgress({ phase: 'saving' })

    const backup = await backupManager.createBackup(config, result.messages, result.mediaBlobs)
    backupsStore.addBackup(backup)

    // Store for potential ZIP download
    lastExportResult.value = {
      ...backup,
      messages: result.messages,
      mediaBlobs: result.mediaBlobs,
    }

    backupsStore.completeExport()
    step.value = 'complete'

    // Auto-download ZIP if option was selected
    if (downloadZipAfter.value) {
      await downloadAsZip()
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      uiStore.showToast('info', 'Export cancelled')
      step.value = 'configure'
    } else {
      console.error('[ExportView] Export failed:', e)
      const friendlyError = toUserFriendlyError(e)
      // Show both friendly message and original error for debugging
      error.value = friendlyError.message
      if (friendlyError.originalError && friendlyError.originalError !== friendlyError.message) {
        error.value += ` (${friendlyError.originalError})`
      }
      backupsStore.setExportError(friendlyError.originalError)
      step.value = 'configure'
    }
  }
}

async function downloadAsZip() {
  if (!lastExportResult.value) return

  isDownloadingZip.value = true
  try {
    await zipGenerator.generateAndDownload(lastExportResult.value)
    uiStore.showToast('success', 'ZIP downloaded successfully!')
  } catch (e) {
    const friendlyError = toUserFriendlyError(e)
    uiStore.showToast('error', friendlyError.message)
  } finally {
    isDownloadingZip.value = false
  }
}

function formatDate(date?: Date): string {
  if (!date) return ''
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}
</script>

<template>
  <div class="max-w-2xl mx-auto py-8 px-4">
    <!-- Step 1: Select Chat -->
    <template v-if="step === 'select-chat'">
      <header class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('export.title') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">
          {{ t('export.selectChat') }}
        </p>
      </header>

      <div class="mb-4">
        <input
          v-model="searchQuery"
          type="search"
          :placeholder="t('export.searchChats')"
          class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
        />
      </div>

      <div v-if="isLoading" class="text-center py-12">
        <div
          class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
        ></div>
        <p class="text-gray-600 dark:text-gray-400">{{ t('export.loadingChats') }}</p>
      </div>

      <div v-else-if="error" class="text-center py-12 text-red-600">
        {{ error }}
      </div>

      <div v-else-if="exportableChatsCount === 0" class="text-center py-12">
        <div class="text-3xl mb-3">🔒</div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {{ t('export.noExportableChats') }}
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('export.needAdmin') }}
        </p>
      </div>

      <div v-else class="space-y-2">
        <button
          v-for="chat in filteredChats"
          :key="chat.id.toString()"
          @click="selectChat(chat)"
          class="flex items-center gap-3 w-full p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow hover:border-gray-300 dark:hover:border-gray-700 transition-all duration-100 text-left"
        >
          <div
            class="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg text-xl"
          >
            {{ chat.type === 'channel' ? '📢' : chat.type === 'supergroup' ? '👥' : '💬' }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-900 dark:text-white truncate">
              {{ chat.title }}
            </div>
            <div class="text-xs text-gray-500">
              {{ chat.type }} • {{ formatDate(chat.lastMessageDate) }}
            </div>
          </div>
          <span
            class="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
            >{{ t('common.admin') }}</span
          >
        </button>
      </div>
    </template>

    <!-- Step 2: Configure Export -->
    <template v-else-if="step === 'configure'">
      <header class="mb-6">
        <button
          @click="goBack"
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-100"
        >
          ← {{ t('common.back') }}
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('export.configure') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">
          {{ t('export.exportingFrom') }} <strong>{{ selectedChat?.title }}</strong>
        </p>
      </header>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {{ t('export.exportMode') }}
          </label>
          <div class="space-y-2">
            <label
              class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-100"
            >
              <input v-model="exportMode" type="radio" value="all" class="text-blue-600" />
              <div>
                <div class="font-medium text-sm text-gray-900 dark:text-white">
                  {{ t('export.allContent') }}
                </div>
                <div class="text-xs text-gray-500">{{ t('export.allContentDesc') }}</div>
              </div>
            </label>
            <label
              class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-100"
            >
              <input v-model="exportMode" type="radio" value="text_only" class="text-blue-600" />
              <div>
                <div class="font-medium text-sm text-gray-900 dark:text-white">
                  {{ t('export.textOnly') }}
                </div>
                <div class="text-xs text-gray-500">{{ t('export.textOnlyDesc') }}</div>
              </div>
            </label>
            <label
              class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-100"
            >
              <input v-model="exportMode" type="radio" value="media_only" class="text-blue-600" />
              <div>
                <div class="font-medium text-sm text-gray-900 dark:text-white">
                  {{ t('export.mediaOnly') }}
                </div>
                <div class="text-xs text-gray-500">{{ t('export.mediaOnlyDesc') }}</div>
              </div>
            </label>
          </div>
        </div>

        <!-- Date Range Filter -->
        <div>
          <label
            class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-100"
          >
            <input v-model="useDateFilter" type="checkbox" class="text-blue-600 rounded" />
            <div>
              <div class="font-medium text-sm text-gray-900 dark:text-white">
                {{ t('export.dateFilter') }}
              </div>
              <div class="text-xs text-gray-500">
                {{ t('export.dateFilterDesc') }}
              </div>
            </div>
          </label>

          <div v-if="useDateFilter" class="mt-3 pl-10 space-y-3">
            <!-- Quick presets -->
            <div class="flex flex-wrap gap-2">
              <button
                v-for="preset in datePresets"
                :key="preset"
                @click="applyDatePreset(preset)"
                :class="[
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors duration-100',
                  datePreset === preset
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
                ]"
              >
                {{ t(`export.datePresets.${preset}`) }}
              </button>
            </div>

            <!-- Custom date inputs -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {{ t('export.fromDate') }}
                </label>
                <input
                  v-model="minDate"
                  type="date"
                  @input="datePreset = 'custom'"
                  class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {{ t('export.toDate') }}
                </label>
                <input
                  v-model="maxDate"
                  type="date"
                  @input="datePreset = 'custom'"
                  class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
                />
              </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('export.dateHint') }}
            </p>
          </div>
        </div>

        <!-- Download as ZIP option -->
        <div>
          <label
            class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-100"
          >
            <input v-model="downloadZipAfter" type="checkbox" class="text-blue-600 rounded" />
            <div>
              <div class="font-medium text-sm text-gray-900 dark:text-white">
                {{ t('export.downloadZip') }}
              </div>
              <div class="text-xs text-gray-500">
                {{ t('export.downloadZipDesc') }}
              </div>
            </div>
          </label>
        </div>

        <!-- Info box -->
        <div
          class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800"
        >
          <div class="flex gap-3">
            <span class="text-blue-600">ℹ️</span>
            <div class="text-sm text-blue-800 dark:text-blue-300">
              <p class="mb-1">
                <strong>{{ t('export.parallelInfo') }}</strong>
              </p>
              <p class="text-xs text-blue-700 dark:text-blue-400">
                {{ t('export.parallelInfoDesc') }}
              </p>
            </div>
          </div>
        </div>

        <div v-if="error" class="text-red-600 text-sm p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          {{ error }}
        </div>

        <button
          @click="showConfirmation"
          class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
        >
          {{ t('common.continue') }}
        </button>
      </div>
    </template>

    <!-- Step 3: Confirm -->
    <template v-else-if="step === 'confirm'">
      <header class="mb-6">
        <button
          @click="goBack"
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-100"
        >
          ← {{ t('common.back') }}
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('export.confirmTitle') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('export.confirmSubtitle') }}</p>
      </header>

      <div class="space-y-4">
        <!-- Summary card -->
        <div
          class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div class="space-y-3">
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600 dark:text-gray-400">{{ t('export.chat') }}:</span>
              <span class="font-medium text-gray-900 dark:text-white">
                {{ selectedChat?.title }}
              </span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600 dark:text-gray-400"
                >{{ t('export.exportMode') }}:</span
              >
              <span class="font-medium text-gray-900 dark:text-white">
                {{
                  exportMode === 'all'
                    ? t('export.allContent')
                    : exportMode === 'text_only'
                      ? t('export.textOnly')
                      : t('export.mediaOnly')
                }}
              </span>
            </div>
            <div
              v-if="useDateFilter && (minDate || maxDate)"
              class="flex justify-between items-center"
            >
              <span class="text-sm text-gray-600 dark:text-gray-400"
                >{{ t('export.dateRange') }}:</span
              >
              <span class="font-medium text-gray-900 dark:text-white">
                {{ minDate || t('export.any') }} → {{ maxDate || t('export.any') }}
              </span>
            </div>
          </div>
        </div>

        <!-- Configuration summary -->
        <div
          class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            {{ t('export.whatToExpect') }}
          </h3>
          <ul class="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <li>• {{ t('export.expectFetch') }}</li>
            <li v-if="exportMode !== 'text_only'">• {{ t('export.expectMedia') }}</li>
            <li>• {{ t('export.expectSave') }}</li>
            <li v-if="downloadZipAfter">• {{ t('export.expectZip') }}</li>
          </ul>
        </div>

        <!-- Info box -->
        <div
          class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800"
        >
          <div class="flex gap-3">
            <span class="text-blue-600">ℹ️</span>
            <div class="text-sm text-blue-800 dark:text-blue-300">
              <p>{{ t('export.exportWarning') }}</p>
            </div>
          </div>
        </div>

        <div v-if="error" class="text-red-600 text-sm p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          {{ error }}
        </div>

        <div class="flex gap-3">
          <button
            @click="goBack"
            class="flex-1 px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            {{ t('common.back') }}
          </button>
          <button
            @click="confirmAndStart"
            class="flex-1 px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
          >
            {{ t('common.startExport') }}
          </button>
        </div>
      </div>
    </template>

    <!-- Step 3: Exporting -->
    <template v-else-if="step === 'exporting'">
      <div class="text-center py-12">
        <div
          class="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-5"
        ></div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ phaseLabel }}</h2>

        <div v-if="floodWaitSeconds > 0" class="text-amber-600 mb-3">
          <div class="flex items-center justify-center gap-2">
            <span class="animate-pulse">⏳</span>
            <span>{{ t('export.rateLimited', { seconds: floodWaitRemaining }) }}</span>
          </div>
          <!-- Countdown progress bar -->
          <div
            class="w-full max-w-xs mx-auto h-1.5 bg-amber-200 dark:bg-amber-900 rounded-full overflow-hidden mt-2"
          >
            <div
              class="h-full bg-amber-500 transition-all duration-1000 ease-linear"
              :style="{
                width: `${((floodWaitSeconds - floodWaitRemaining) / floodWaitSeconds) * 100}%`,
              }"
            ></div>
          </div>
        </div>

        <div class="text-2xl font-bold text-blue-600 mb-3">
          {{ currentProgress?.processedMessages ?? 0 }}
          <span v-if="currentProgress?.totalMessages" class="text-gray-400">
            / {{ currentProgress.totalMessages }}
          </span>
          <span class="text-base font-normal text-gray-500">
            {{ ' ' + t('export.messages', { count: currentProgress?.totalMessages || 0 }) }}
          </span>
        </div>

        <!-- Progress bar -->
        <div
          v-if="currentProgress?.phase === 'downloading_media'"
          class="w-full max-w-xs mx-auto h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-4"
        >
          <div
            class="h-full bg-blue-600 transition-all duration-100"
            :style="{ width: `${progressPercentage}%` }"
          ></div>
        </div>

        <!-- Stats -->
        <div class="text-xs text-gray-500 space-y-1">
          <div v-if="currentProgress?.exportedTextMessages">
            📝 {{ t('export.textMessages', { count: currentProgress.exportedTextMessages }) }}
          </div>
          <div v-if="currentProgress?.exportedMediaMessages">
            📎 {{ t('export.mediaDownloaded', { count: currentProgress.exportedMediaMessages }) }}
          </div>
          <div v-if="currentProgress?.failedMessages" class="text-red-500">
            ❌ {{ t('export.failed', { count: currentProgress.failedMessages }) }}
          </div>
          <div v-if="estimatedTimeRemaining" class="text-blue-600 mt-2">
            ⏱️ {{ t('export.remaining', { time: estimatedTimeRemaining }) }}
          </div>
        </div>

        <!-- Error state with reconnect option -->
        <div
          v-if="currentProgress?.phase === 'error'"
          class="mt-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
        >
          <p class="text-sm text-red-700 dark:text-red-300 mb-3">
            {{ currentProgress.errorMessage || t('export.errorOccurred') }}
          </p>
          <div class="flex justify-center gap-3">
            <button
              v-if="telegramService.canManualReconnect()"
              @click="handleManualReconnect"
              :disabled="isReconnecting"
              class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100"
            >
              <span v-if="isReconnecting">{{ t('export.reconnecting') }}</span>
              <span v-else>🔄 {{ t('export.reconnect') }}</span>
            </button>
            <button
              @click="goBack"
              class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-100"
            >
              {{ t('common.back') }}
            </button>
          </div>
        </div>

        <button
          v-if="currentProgress?.phase !== 'error'"
          @click="cancelExport"
          class="mt-6 px-4 py-2 rounded-md font-medium text-sm bg-red-600 text-white hover:bg-red-700 transition-colors duration-100"
        >
          {{ t('export.cancelExport') }}
        </button>
      </div>
    </template>

    <!-- Step 4: Complete -->
    <template v-else-if="step === 'complete'">
      <div class="text-center py-12">
        <div class="text-4xl mb-4">✅</div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {{ t('export.exportComplete') }}
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">
          {{
            t('export.successMessage', {
              count: currentProgress?.processedMessages ?? 0,
              chat: selectedChat?.title,
            })
          }}
        </p>

        <div class="text-xs text-gray-500 mb-6 space-y-1">
          <div v-if="currentProgress?.exportedTextMessages">
            📝 {{ t('export.textMessages', { count: currentProgress.exportedTextMessages }) }}
          </div>
          <div v-if="currentProgress?.exportedMediaMessages">
            📎 {{ t('export.mediaFiles', { count: currentProgress.exportedMediaMessages }) }}
          </div>
          <div v-if="currentProgress?.failedMessages" class="text-amber-600">
            ⚠️ {{ t('export.failedSkip', { count: currentProgress.failedMessages }) }}
          </div>
        </div>

        <div class="flex flex-wrap gap-3 justify-center">
          <button
            v-if="lastExportResult"
            @click="downloadAsZip"
            :disabled="isDownloadingZip"
            class="px-4 py-2 rounded-md font-medium text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-100 flex items-center gap-2"
          >
            <span v-if="isDownloadingZip" class="animate-spin">⏳</span>
            <span>{{
              isDownloadingZip ? t('export.generating') : '📥 ' + t('export.downloadZipBtn')
            }}</span>
          </button>
          <router-link
            to="/backups"
            class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
          >
            {{ t('export.viewBackups') }}
          </router-link>
          <button
            @click="resetExport"
            class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            {{ t('export.exportAnother') }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
