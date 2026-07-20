<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import FloodWaitIndicator from '@/components/common/FloodWaitIndicator.vue'
import PersistenceNotice from '@/components/storage/PersistenceNotice.vue'
import { useFloodWait } from '@/composables'
import { chatArchiveService } from '@/services/llm-export/archive-service'
import { chatHistoryService } from '@/services/llm-export/chat-history-service'
import {
  formatMessages,
  getFormatFileExtension,
  getFormatMimeType,
} from '@/services/llm-export/format-service'
import { quotaManager } from '@/services/storage/quota'
import { telegramService } from '@/services/telegram/client'
import { useAccountsStore, useUiStore } from '@/stores'
import type {
  ChatArchiveProgress,
  ChatArchiveResult,
  ChatArchiveTask,
  ChatExport,
  ChatHistoryProgress,
  ChatHistoryTask,
  ChatInfo,
  ChatMessage,
  FormatConfig,
} from '@/types'
import { DEFAULT_FORMAT_CONFIG } from '@/types'
import { parseDateInputBoundary } from '@/utils/date-input'
import { toUserFriendlyError } from '@/utils/error-messages'
import ChatSelector from './components/ChatSelector.vue'
import DownloadOptionsCard from './components/DownloadOptionsCard.vue'
import ExportsList from './components/ExportsList.vue'
import ExportWorkspace from './components/ExportWorkspace.vue'

const { t } = useI18n()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()

const activeTab = ref<'new' | 'exports'>('new')

const chats = ref<ChatInfo[]>([])
const isLoadingChats = ref(false)
const selectedChat = ref<ChatInfo | null>(null)

const downloadTask = shallowRef<ChatHistoryTask | null>(null)
const downloadProgress = ref<ChatHistoryProgress | null>(null)

const archiveTask = shallowRef<ChatArchiveTask | null>(null)
const archiveProgress = ref<ChatArchiveProgress | null>(null)

const cachedExports = ref<ChatExport[]>([])
const archivedExports = ref<ChatExport[]>([])
const quarantinedExports = ref<ChatExport[]>([])
const evictedExportIds = ref<Set<string>>(new Set())
const isLoadingExportsList = ref(false)
const exportsError = ref('')
const selectedExport = ref<ChatExport | null>(null)
const exportMessages = ref<ChatMessage[]>([])
const isLoadingSelectedExport = ref(false)

const formatConfig = ref<FormatConfig>({ ...DEFAULT_FORMAT_CONFIG })

const downloadLimit = ref(0)
const downloadMinDate = ref('')
const downloadMaxDate = ref('')

const floodWait = useFloodWait()

const error = ref('')
let chatsRequestId = 0
let storedExportsRequestId = 0
let exportSelectionRequestId = 0

const isDownloading = computed(() => downloadTask.value !== null)
const isDownloadingArchive = computed(() => archiveTask.value !== null)

const archiveStatusText = computed(() => {
  if (!archiveProgress.value) {
    return ''
  }

  switch (archiveProgress.value.phase) {
    case 'fetching_messages':
      return t('llmExport.downloading')
    case 'downloading_media':
      return archiveProgress.value.downloadedMediaMessages > 0
        ? `${t('export.downloadingMedia')} • ${t('export.mediaDownloaded', { count: archiveProgress.value.downloadedMediaMessages })}`
        : t('export.downloadingMedia')
    case 'preparing':
    case 'building_archive':
      return t('export.generating')
    case 'cancelled':
      return t('common.cancel')
    default:
      return ''
  }
})

onUnmounted(() => {
  chatsRequestId++
  storedExportsRequestId++
  exportSelectionRequestId++
  downloadTask.value?.cancel()
  archiveTask.value?.cancel()
})

watch(
  () => accountsStore.activeAccountId,
  async () => {
    downloadTask.value?.cancel()
    archiveTask.value?.cancel()
    chatsRequestId++
    storedExportsRequestId++
    exportSelectionRequestId++
    downloadTask.value = null
    archiveTask.value = null
    downloadProgress.value = null
    archiveProgress.value = null
    activeTab.value = 'new'
    selectedChat.value = null
    selectedExport.value = null
    exportMessages.value = []
    cachedExports.value = []
    archivedExports.value = []
    quarantinedExports.value = []
    evictedExportIds.value = new Set()
    isLoadingChats.value = false
    isLoadingExportsList.value = false
    isLoadingSelectedExport.value = false
    error.value = ''
    exportsError.value = ''
    floodWait.reset()

    if (accountsStore.activeAccount?.type !== 'user') {
      chats.value = []
      cachedExports.value = []
      archivedExports.value = []
      quarantinedExports.value = []
      return
    }

    await Promise.all([loadChats(), loadStoredExports()])
  },
  { immediate: true },
)

async function loadChats() {
  const requestId = ++chatsRequestId
  const accountId = accountsStore.activeAccountId
  isLoadingChats.value = true
  error.value = ''

  try {
    const loadedChats = await telegramService.getDialogs()
    if (requestId !== chatsRequestId || accountsStore.activeAccountId !== accountId) {
      return
    }

    chats.value = loadedChats
  } catch (loadError) {
    if (requestId !== chatsRequestId || accountsStore.activeAccountId !== accountId) {
      return
    }

    error.value = loadError instanceof Error ? loadError.message : t('common.error')
  } finally {
    if (requestId === chatsRequestId && accountsStore.activeAccountId === accountId) {
      isLoadingChats.value = false
    }
  }
}

function sortChatExportsByNewest(chatExports: ChatExport[]): ChatExport[] {
  return chatExports.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
}

function isExportEvicted(id: string): boolean {
  return evictedExportIds.value.has(id)
}

async function loadStoredExports() {
  const requestId = ++storedExportsRequestId
  const account = accountsStore.activeAccount
  const accountId = account?.id ?? null
  isLoadingExportsList.value = true
  exportsError.value = ''

  try {
    const visibleExports = await chatHistoryService.listChatExportsForAccount(account)
    const archived = await chatHistoryService.listArchivedChatExports()
    const quarantined = await chatHistoryService.listQuarantinedChatExports()
    const evicted = await chatHistoryService.listEvictedChatExportIds([
      ...visibleExports,
      ...archived,
      ...quarantined,
    ])
    if (requestId !== storedExportsRequestId || accountsStore.activeAccountId !== accountId) {
      return
    }

    cachedExports.value = sortChatExportsByNewest(visibleExports)
    archivedExports.value = sortChatExportsByNewest(archived)
    quarantinedExports.value = sortChatExportsByNewest(quarantined)
    evictedExportIds.value = evicted

    if (
      selectedExport.value &&
      !cachedExports.value.some((chatExport) => chatExport.id === selectedExport.value?.id)
    ) {
      selectedExport.value = null
      exportMessages.value = []
    }
  } catch (loadError) {
    if (requestId !== storedExportsRequestId || accountsStore.activeAccountId !== accountId) {
      return
    }

    exportsError.value =
      loadError instanceof Error ? loadError.message : 'Failed to load cached exports'
  } finally {
    if (requestId === storedExportsRequestId && accountsStore.activeAccountId === accountId) {
      isLoadingExportsList.value = false
    }
  }
}

function handleChatSelect(chat: ChatInfo) {
  selectedChat.value = chat
}

async function startDownload() {
  if (!selectedChat.value || isDownloading.value) {
    return
  }

  error.value = ''
  downloadProgress.value = null
  floodWait.reset()
  // This is a durable local-data workflow (the export is persisted to IndexedDB), so request
  // persistent storage now; denial degrades to best-effort with the persistence notice shown.
  await quotaManager.ensurePersisted()
  const account = accountsStore.activeAccount
  const accountId = account?.id ?? null
  const ownerEpoch = accountId !== null ? accountsStore.getAccountEpoch(accountId) : null
  // Commit fence for the export write: rejects if the owning account is removed mid-download so no
  // orphaned owned export is persisted.
  const ensureCommittable =
    accountId !== null
      ? () => {
          if (accountsStore.getAccountEpoch(accountId) !== ownerEpoch) {
            throw new DOMException('Owning account was removed during export', 'AbortError')
          }
        }
      : undefined

  const task = chatHistoryService.createDownloadTask(
    selectedChat.value,
    {
      limit: downloadLimit.value > 0 ? downloadLimit.value : undefined,
      minDate: parseDateInputBoundary(downloadMinDate.value, 'start'),
      maxDate: parseDateInputBoundary(downloadMaxDate.value, 'end'),
    },
    {
      onProgress: (progress) => {
        if (accountsStore.activeAccountId === accountId) {
          downloadProgress.value = { ...progress }
        }
      },
      onError: (taskError) => {
        console.error('Download error:', taskError)
      },
      ...floodWait.callbacks,
    },
    account,
    { ensureCommittable },
  )

  downloadTask.value = task

  try {
    const result = await task.promise
    if (downloadTask.value !== task || accountsStore.activeAccountId !== accountId) {
      return
    }

    await loadStoredExports()
    if (downloadTask.value !== task || accountsStore.activeAccountId !== accountId) {
      return
    }

    selectedExport.value = result.chatExport
    exportMessages.value = result.messages
    activeTab.value = 'exports'
    selectedChat.value = null

    uiStore.showToast('success', t('llmExport.downloadComplete'))
  } catch (taskError) {
    if (downloadTask.value !== task || accountsStore.activeAccountId !== accountId) {
      return
    }

    if (taskError instanceof DOMException && taskError.name === 'AbortError') {
      uiStore.showToast('info', t('llmExport.downloadCancelled'))
    } else {
      error.value = toUserFriendlyError(taskError).message
    }
  } finally {
    if (downloadTask.value === task) {
      downloadTask.value = null
    }
  }
}

function cancelDownload() {
  downloadTask.value?.cancel()
}

function stopAndSaveDownload() {
  downloadTask.value?.stopAndSave()
}

async function handleExportSelect(chatExport: ChatExport) {
  // An evicted export has metadata but no message rows; opening it would render an empty workspace
  // with no explanation. Surface the content-unavailable state instead.
  if (isExportEvicted(chatExport.id)) {
    return
  }

  const requestId = ++exportSelectionRequestId
  const accountId = accountsStore.activeAccountId
  isLoadingSelectedExport.value = true
  error.value = ''

  try {
    const result = await chatHistoryService.loadChatExport(
      chatExport.id,
      accountsStore.activeAccount,
    )
    if (requestId !== exportSelectionRequestId || accountsStore.activeAccountId !== accountId) {
      return
    }

    if (result) {
      selectedExport.value = result.chatExport
      exportMessages.value = result.messages
    }
  } catch (loadError) {
    if (requestId !== exportSelectionRequestId || accountsStore.activeAccountId !== accountId) {
      return
    }

    error.value = loadError instanceof Error ? loadError.message : t('common.error')
  } finally {
    if (requestId === exportSelectionRequestId && accountsStore.activeAccountId === accountId) {
      isLoadingSelectedExport.value = false
    }
  }
}

async function handleExportDelete(exportId: string) {
  try {
    await chatHistoryService.deleteChatExport(exportId, accountsStore.activeAccount)
    await loadStoredExports()

    if (selectedExport.value?.id === exportId) {
      selectedExport.value = null
      exportMessages.value = []
    }

    uiStore.showToast('success', t('llmExport.exportDeleted'))
  } catch {
    uiStore.showToast('error', t('llmExport.deleteError'))
  }
}

async function handleExportClaim(exportId: string) {
  const activeAccount = accountsStore.activeAccount
  if (!activeAccount || activeAccount.type !== 'user') {
    return
  }

  try {
    await chatHistoryService.claimLegacyChatExport(exportId, activeAccount)
    await loadStoredExports()
    uiStore.showToast('success', t('llmExport.claimSuccess'))
  } catch {
    uiStore.showToast('error', t('llmExport.claimError'))
  }
}

async function handleExportReconcile(exportId: string) {
  const activeAccount = accountsStore.activeAccount
  if (!activeAccount || activeAccount.type !== 'user') {
    return
  }

  try {
    await chatHistoryService.reconcileChatExport(exportId, activeAccount)
    await loadStoredExports()
    uiStore.showToast('success', t('llmExport.repairSuccess'))
  } catch {
    uiStore.showToast('error', t('llmExport.repairError'))
  }
}

function getFormattedOutput(): string {
  if (!selectedExport.value || exportMessages.value.length === 0) {
    return ''
  }

  return formatMessages(exportMessages.value, selectedExport.value, formatConfig.value)
}

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(getFormattedOutput())
    uiStore.showToast('success', t('llmExport.copiedToClipboard'))
  } catch {
    uiStore.showToast('error', t('llmExport.copyError'))
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_')
}

function downloadAsFile() {
  const output = getFormattedOutput()
  const chatTitle = sanitizeFilename(selectedExport.value?.chatTitle || 'chat')
  const extension = getFormatFileExtension(formatConfig.value.template)
  const blob = new Blob([output], {
    type: getFormatMimeType(formatConfig.value.template),
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${chatTitle}.${extension}`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function downloadArchiveResult(result: ChatArchiveResult) {
  const url = URL.createObjectURL(result.blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = result.filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

async function downloadAsZip() {
  if (!selectedExport.value || exportMessages.value.length === 0 || isDownloadingArchive.value) {
    return
  }

  floodWait.reset()
  archiveProgress.value = null
  error.value = ''
  const accountId = accountsStore.activeAccountId

  const task = chatArchiveService.createArchiveTask(
    selectedExport.value,
    exportMessages.value,
    formatConfig.value,
    {
      onProgress: (progress) => {
        if (accountsStore.activeAccountId === accountId) {
          archiveProgress.value = { ...progress }
        }
      },
      onError: (taskError, messageId) => {
        console.warn('Archive media download failed', messageId, taskError)
      },
      ...floodWait.callbacks,
    },
  )

  archiveTask.value = task

  try {
    const result = await task.promise
    if (archiveTask.value !== task || accountsStore.activeAccountId !== accountId) {
      return
    }

    downloadArchiveResult(result)

    if (result.mediaFailures.length > 0) {
      uiStore.showToast('warning', t('export.failedSkip', { count: result.mediaFailures.length }))
    }
  } catch (taskError) {
    if (archiveTask.value !== task || accountsStore.activeAccountId !== accountId) {
      return
    }

    if (!(taskError instanceof DOMException && taskError.name === 'AbortError')) {
      const friendlyError = toUserFriendlyError(taskError)
      error.value = friendlyError.message
      uiStore.showToast('error', friendlyError.message)
    }
  } finally {
    if (archiveTask.value === task) {
      archiveTask.value = null
    }
  }
}

function cancelArchiveDownload() {
  archiveTask.value?.cancel()
}
</script>

<template>
  <div class="max-w-6xl mx-auto py-8 px-4 space-y-6">
    <header>
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
        {{ t('llmExport.title') }}
      </h1>
      <p class="text-sm text-gray-600 dark:text-gray-400 mt-2">
        {{ t('llmExport.description') }}
      </p>
    </header>

    <PersistenceNotice />

    <div class="flex gap-1 border-b border-gray-200 dark:border-gray-800">
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-100"
        :class="
          activeTab === 'new'
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
        "
        @click="activeTab = 'new'"
      >
        {{ t('llmExport.newExport') }}
      </button>
      <button
        class="px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-100"
        :class="
          activeTab === 'exports'
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
        "
        @click="activeTab = 'exports'"
      >
        {{ t('llmExport.myExports') }}
        <span
          v-if="cachedExports.length > 0"
          class="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
        >
          {{ cachedExports.length }}
        </span>
      </button>
    </div>

    <div
      v-if="error"
      class="p-4 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300"
    >
      {{ error }}
    </div>

    <div v-if="activeTab === 'new'" class="space-y-6">
      <div
        v-if="isDownloading"
        class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <div class="text-center">
          <div class="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {{ t('llmExport.downloading') }}
          </h3>
          <p class="text-sm text-gray-600 dark:text-gray-400 break-words">
            {{ selectedChat?.title }}
          </p>

          <div class="text-2xl font-bold text-blue-600 mt-4">
            {{ downloadProgress?.fetchedMessages || 0 }}
            <span v-if="downloadProgress?.totalEstimate" class="text-gray-400">
              / ~{{ downloadProgress.totalEstimate }}
            </span>
            <span class="text-base font-normal text-gray-500 ml-1">
              {{ t('llmExport.messages') }}
            </span>
          </div>

          <FloodWaitIndicator
            :seconds="floodWait.seconds.value"
            :remaining="floodWait.remaining.value"
            :progress="floodWait.progress.value"
          />

          <div class="mt-4 flex flex-wrap items-center justify-center gap-3">
            <button
              v-if="downloadProgress && downloadProgress.fetchedMessages > 0"
              class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
              @click="stopAndSaveDownload"
            >
              {{ t('llmExport.stopAndSave') }}
            </button>
            <button
              class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-100"
              @click="cancelDownload"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>

      <template v-else>
        <ChatSelector :chats="chats" :is-loading="isLoadingChats" :selected-chat="selectedChat" @select="handleChatSelect" />

        <DownloadOptionsCard
          v-if="selectedChat"
          :chat="selectedChat"
          :limit="downloadLimit"
          :min-date="downloadMinDate"
          :max-date="downloadMaxDate"
          :is-submitting="isDownloading"
          @update:limit="downloadLimit = $event"
          @update:min-date="downloadMinDate = $event"
          @update:max-date="downloadMaxDate = $event"
          @start="startDownload"
        />
      </template>
    </div>

    <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div class="lg:col-span-1">
        <ExportsList
          :exports="cachedExports"
          :archived-exports="archivedExports"
          :quarantined-exports="quarantinedExports"
          :evicted-export-ids="evictedExportIds"
          :can-reconcile="accountsStore.activeAccount?.type === 'user'"
          :selected-export-id="selectedExport?.id"
          :is-loading-list="isLoadingExportsList"
          :is-loading-selection="isLoadingSelectedExport"
          :error-message="exportsError"
          @select="handleExportSelect"
          @delete="handleExportDelete"
          @claim="handleExportClaim"
          @reconcile="handleExportReconcile"
        />
      </div>

      <div class="lg:col-span-2">
        <ExportWorkspace
          :chat-export="selectedExport"
          :messages="exportMessages"
          :config="formatConfig"
          :is-loading="isLoadingSelectedExport"
          :is-downloading-archive="isDownloadingArchive"
          :archive-progress="archiveProgress"
          :archive-status-text="archiveStatusText"
          :flood-wait-seconds="floodWait.seconds.value"
          :flood-wait-remaining="floodWait.remaining.value"
          :flood-wait-progress="floodWait.progress.value"
          @update:config="formatConfig = $event"
          @copy="copyToClipboard"
          @download-file="downloadAsFile"
          @download-zip="downloadAsZip"
          @cancel-zip="cancelArchiveDownload"
        />
      </div>
    </div>
  </div>
</template>
