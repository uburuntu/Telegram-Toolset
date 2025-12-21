<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBackupsStore, useUiStore } from '@/stores'
import { telegramService } from '@/services/telegram/client'
import { backupManager } from '@/services/storage/backup-manager'
import { quotaManager } from '@/services/storage/quota'
import { exportService } from '@/services/export/export-service'
import { zipGenerator } from '@/services/export/zip-generator'
import { formatDuration } from '@/services/telegram/rate-limiter'
import { toUserFriendlyError } from '@/utils/error-messages'
import type { ChatInfo, ExportConfig, ExportProgress, BackupWithMessages } from '@/types'

const router = useRouter()
const backupsStore = useBackupsStore()
const uiStore = useUiStore()

// State
const step = ref<'select-chat' | 'configure' | 'exporting' | 'complete'>('select-chat')
const chats = ref<ChatInfo[]>([])
const searchQuery = ref('')
const selectedChat = ref<ChatInfo | null>(null)
const exportMode = ref<'all' | 'media_only' | 'text_only'>('all')
const downloadZipAfter = ref(false)
const isLoading = ref(false)
const error = ref('')
const isDownloadingZip = ref(false)

// Date range filtering
const useDateFilter = ref(false)
const minDate = ref('')
const maxDate = ref('')

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
    (currentProgress.value.processedMessages / currentProgress.value.totalMessages) * 100
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
      return 'Fetching deleted messages...'
    case 'downloading_media':
      return 'Downloading media files...'
    case 'saving':
      return 'Saving to storage...'
    case 'complete':
      return 'Complete!'
    case 'error':
      return 'Error occurred'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Initializing...'
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
  } else if (step.value === 'complete') {
    router.push('/backups')
  }
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
        ? new Date(maxDate.value + 'T23:59:59') // Include the entire day
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
      const friendlyError = toUserFriendlyError(e)
      error.value = friendlyError.message
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
          Export Deleted Messages
        </h1>
        <p class="text-gray-600 dark:text-gray-400">
          Select a channel or group where you have admin access
        </p>
      </header>

      <div class="mb-4">
        <input
          v-model="searchQuery"
          type="search"
          placeholder="Search chats..."
          class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-150"
        />
      </div>

      <div v-if="isLoading" class="text-center py-12">
        <div
          class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
        ></div>
        <p class="text-gray-600 dark:text-gray-400">Loading chats...</p>
      </div>

      <div v-else-if="error" class="text-center py-12 text-red-600">
        {{ error }}
      </div>

      <div v-else-if="exportableChatsCount === 0" class="text-center py-12">
        <div class="text-3xl mb-3">🔒</div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          No exportable chats found
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          You need admin access to channels or supergroups to export deleted messages
        </p>
      </div>

      <div v-else class="space-y-2">
        <button
          v-for="chat in filteredChats"
          :key="chat.id.toString()"
          @click="selectChat(chat)"
          class="flex items-center gap-3 w-full p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow hover:border-gray-300 dark:hover:border-gray-700 transition-all duration-150 text-left"
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
            >Admin</span
          >
        </button>
      </div>
    </template>

    <!-- Step 2: Configure Export -->
    <template v-else-if="step === 'configure'">
      <header class="mb-6">
        <button
          @click="goBack"
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-150"
        >
          ← Back
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Configure Export</h1>
        <p class="text-gray-600 dark:text-gray-400">
          Exporting from: <strong>{{ selectedChat?.title }}</strong>
        </p>
      </header>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Export Mode
          </label>
          <div class="space-y-2">
            <label
              class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-150"
            >
              <input v-model="exportMode" type="radio" value="all" class="text-blue-600" />
              <div>
                <div class="font-medium text-sm text-gray-900 dark:text-white">All content</div>
                <div class="text-xs text-gray-500">Export text and media files</div>
              </div>
            </label>
            <label
              class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-150"
            >
              <input v-model="exportMode" type="radio" value="text_only" class="text-blue-600" />
              <div>
                <div class="font-medium text-sm text-gray-900 dark:text-white">Text only</div>
                <div class="text-xs text-gray-500">Skip media files, faster export</div>
              </div>
            </label>
            <label
              class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-150"
            >
              <input v-model="exportMode" type="radio" value="media_only" class="text-blue-600" />
              <div>
                <div class="font-medium text-sm text-gray-900 dark:text-white">Media only</div>
                <div class="text-xs text-gray-500">Only messages with media</div>
              </div>
            </label>
          </div>
        </div>

        <!-- Date Range Filter -->
        <div>
          <label
            class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-150"
          >
            <input v-model="useDateFilter" type="checkbox" class="text-blue-600 rounded" />
            <div>
              <div class="font-medium text-sm text-gray-900 dark:text-white">
                Filter by date range
              </div>
              <div class="text-xs text-gray-500">
                Only export messages within a specific time period
              </div>
            </div>
          </label>

          <div v-if="useDateFilter" class="mt-3 pl-10 space-y-3">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  From date
                </label>
                <input
                  v-model="minDate"
                  type="date"
                  class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-150"
                />
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  To date
                </label>
                <input
                  v-model="maxDate"
                  type="date"
                  class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-150"
                />
              </div>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              Leave empty to export all messages without date restriction.
            </p>
          </div>
        </div>

        <!-- Download as ZIP option -->
        <div>
          <label
            class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-150"
          >
            <input v-model="downloadZipAfter" type="checkbox" class="text-blue-600 rounded" />
            <div>
              <div class="font-medium text-sm text-gray-900 dark:text-white">
                Download as ZIP after export
              </div>
              <div class="text-xs text-gray-500">
                Automatically download a ZIP file when export completes
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
              <p class="mb-1"><strong>Parallel downloads enabled</strong></p>
              <p class="text-xs text-blue-700 dark:text-blue-400">
                Media files will be downloaded in parallel (up to 4 at once) for faster exports.
                Rate limits are automatically handled.
              </p>
            </div>
          </div>
        </div>

        <div v-if="error" class="text-red-600 text-sm p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
          {{ error }}
        </div>

        <button
          @click="startExport"
          class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-150"
        >
          Start Export
        </button>
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
            <span>Rate limited. Resuming in {{ floodWaitRemaining }}s...</span>
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
          <span class="text-base font-normal text-gray-500"> messages</span>
        </div>

        <!-- Progress bar -->
        <div
          v-if="currentProgress?.phase === 'downloading_media'"
          class="w-full max-w-xs mx-auto h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-4"
        >
          <div
            class="h-full bg-blue-600 transition-all duration-150"
            :style="{ width: `${progressPercentage}%` }"
          ></div>
        </div>

        <!-- Stats -->
        <div class="text-xs text-gray-500 space-y-1">
          <div v-if="currentProgress?.exportedTextMessages">
            📝 {{ currentProgress.exportedTextMessages }} text messages
          </div>
          <div v-if="currentProgress?.exportedMediaMessages">
            📎 {{ currentProgress.exportedMediaMessages }} media files downloaded
          </div>
          <div v-if="currentProgress?.failedMessages" class="text-red-500">
            ❌ {{ currentProgress.failedMessages }} failed
          </div>
          <div v-if="estimatedTimeRemaining" class="text-blue-600 mt-2">
            ⏱️ ~{{ estimatedTimeRemaining }} remaining
          </div>
        </div>

        <!-- Error state with reconnect option -->
        <div
          v-if="currentProgress?.phase === 'error'"
          class="mt-4 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
        >
          <p class="text-sm text-red-700 dark:text-red-300 mb-3">
            {{ currentProgress.errorMessage || 'Export failed' }}
          </p>
          <div class="flex justify-center gap-3">
            <button
              v-if="telegramService.canManualReconnect()"
              @click="handleManualReconnect"
              :disabled="isReconnecting"
              class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
            >
              <span v-if="isReconnecting">Reconnecting...</span>
              <span v-else>🔄 Reconnect</span>
            </button>
            <button
              @click="goBack"
              class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-150"
            >
              Back
            </button>
          </div>
        </div>

        <button
          v-if="currentProgress?.phase !== 'error'"
          @click="cancelExport"
          class="mt-6 px-4 py-2 rounded-md font-medium text-sm bg-red-600 text-white hover:bg-red-700 transition-colors duration-150"
        >
          Cancel Export
        </button>
      </div>
    </template>

    <!-- Step 4: Complete -->
    <template v-else-if="step === 'complete'">
      <div class="text-center py-12">
        <div class="text-4xl mb-4">✅</div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Export Complete!</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Successfully exported {{ currentProgress?.processedMessages ?? 0 }} messages from
          {{ selectedChat?.title }}
        </p>

        <div class="text-xs text-gray-500 mb-6 space-y-1">
          <div v-if="currentProgress?.exportedTextMessages">
            📝 {{ currentProgress.exportedTextMessages }} text messages
          </div>
          <div v-if="currentProgress?.exportedMediaMessages">
            📎 {{ currentProgress.exportedMediaMessages }} media files
          </div>
          <div v-if="currentProgress?.failedMessages" class="text-amber-600">
            ⚠️ {{ currentProgress.failedMessages }} failed (will be skipped)
          </div>
        </div>

        <div class="flex flex-wrap gap-3 justify-center">
          <button
            v-if="lastExportResult"
            @click="downloadAsZip"
            :disabled="isDownloadingZip"
            class="px-4 py-2 rounded-md font-medium text-sm bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 flex items-center gap-2"
          >
            <span v-if="isDownloadingZip" class="animate-spin">⏳</span>
            <span>{{ isDownloadingZip ? 'Generating...' : '📥 Download ZIP' }}</span>
          </button>
          <router-link
            to="/backups"
            class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-150"
          >
            View Backups
          </router-link>
          <button
            @click="resetExport"
            class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-150"
          >
            Export Another
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
