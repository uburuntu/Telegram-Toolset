<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FloodWaitIndicator from '@/components/common/FloodWaitIndicator.vue'
import { useFloodWait } from '@/composables'
import { chatHistoryService } from '@/services/llm-export/chat-history-service'
import { formatMessages, formatPreview } from '@/services/llm-export/format-service'
import { telegramService } from '@/services/telegram/client'
import { useUiStore } from '@/stores'
import type { ChatExport, ChatHistoryProgress, ChatInfo, ChatMessage, FormatConfig } from '@/types'
import { toUserFriendlyError } from '@/utils/error-messages'
import ChatSelector from './components/ChatSelector.vue'
import ExportsList from './components/ExportsList.vue'
import FormatConfigPanel from './components/FormatConfig.vue'
import LivePreview from './components/LivePreview.vue'

const { t } = useI18n()
const uiStore = useUiStore()

// Debug: catch rendering errors from child components
onErrorCaptured((err, instance, info) => {
  console.error('[LlmExportView] Error captured:', err)
  console.error('[LlmExportView] Component:', instance?.$options?.name || instance)
  console.error('[LlmExportView] Info:', info)
  return false // let it propagate
})

// Tab state
const activeTab = ref<'new' | 'exports'>('new')

// Chat selection state
const chats = ref<ChatInfo[]>([])
const isLoadingChats = ref(false)
const selectedChat = ref<ChatInfo | null>(null)

// Download state
const isDownloading = ref(false)
const downloadProgress = ref<ChatHistoryProgress | null>(null)

// Export state
const cachedExports = ref<ChatExport[]>([])
const selectedExport = ref<ChatExport | null>(null)
const exportMessages = ref<ChatMessage[]>([])
const isLoadingExport = ref(false)

// Format configuration
const formatConfig = ref<FormatConfig>({
  template: 'plain',
  includeDate: true,
  dateFormat: 'short',
  dateGrouping: 'per-message',
  includeSenderName: true,
  includeSenderUsername: false,
  useOriginalSenderNames: false,
  includeReplyContext: true,
  includeMessageIds: false,
  mediaPlaceholder: 'bracket',
  messageLimit: 0,
  reverseOrder: true,
})

// Download options
const downloadLimit = ref<number>(0)
const downloadMinDate = ref('')
const downloadMaxDate = ref('')

// Flood wait state (using composable)
const floodWait = useFloodWait()

// Error state
const error = ref('')

// Computed
const formattedOutput = computed(() => {
  if (!selectedExport.value || exportMessages.value.length === 0) return ''
  return formatMessages(exportMessages.value, selectedExport.value, formatConfig.value)
})

const previewOutput = computed(() => {
  if (!selectedExport.value || exportMessages.value.length === 0) return ''
  return formatPreview(exportMessages.value, selectedExport.value, formatConfig.value, 15)
})

const outputStats = computed(() => {
  const output = formattedOutput.value
  return {
    characters: output.length,
    lines: output.split('\n').length,
    estimatedTokens: Math.ceil(output.length / 4), // Rough estimate
  }
})

// Lifecycle
onMounted(async () => {
  await Promise.all([loadChats(), loadCachedExports()])
})

onUnmounted(() => {
  if (chatHistoryService.isDownloading) {
    chatHistoryService.cancel()
  }
})

// Actions
async function loadChats() {
  isLoadingChats.value = true
  error.value = ''
  try {
    chats.value = await telegramService.getDialogs(100)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load chats'
  } finally {
    isLoadingChats.value = false
  }
}

async function loadCachedExports() {
  try {
    cachedExports.value = await chatHistoryService.listChatExports()
    // Sort by date, newest first
    cachedExports.value.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  } catch (e) {
    console.error('Failed to load cached exports:', e)
  }
}

async function handleChatSelect(chat: ChatInfo) {
  selectedChat.value = chat
}

async function startDownload() {
  if (!selectedChat.value) return

  isDownloading.value = true
  error.value = ''
  downloadProgress.value = null
  floodWait.reset()

  const options: { limit?: number; minDate?: Date; maxDate?: Date } = {}
  if (downloadLimit.value > 0) {
    options.limit = downloadLimit.value
  }
  if (downloadMinDate.value) {
    options.minDate = new Date(downloadMinDate.value)
  }
  if (downloadMaxDate.value) {
    options.maxDate = new Date(`${downloadMaxDate.value}T23:59:59`)
  }

  try {
    const result = await chatHistoryService.downloadChatHistory(selectedChat.value, options, {
      onProgress: (progress) => {
        downloadProgress.value = { ...progress }
      },
      onError: (err) => {
        console.error('Download error:', err)
      },
      ...floodWait.callbacks,
    })

    // Refresh exports list
    await loadCachedExports()

    // Select the new export
    selectedExport.value = result.chatExport
    exportMessages.value = result.messages

    // Switch to exports tab
    activeTab.value = 'exports'

    uiStore.showToast('success', t('llmExport.downloadComplete'))
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      uiStore.showToast('info', t('llmExport.downloadCancelled'))
    } else {
      const friendlyError = toUserFriendlyError(e)
      error.value = friendlyError.message
    }
  } finally {
    isDownloading.value = false
    selectedChat.value = null
  }
}

function cancelDownload() {
  chatHistoryService.cancel()
}

function stopAndSaveDownload() {
  chatHistoryService.stopAndSave()
}

async function handleExportSelect(chatExport: ChatExport) {
  isLoadingExport.value = true
  error.value = ''

  try {
    const result = await chatHistoryService.loadChatExport(chatExport.id)
    if (result) {
      selectedExport.value = result.chatExport
      exportMessages.value = result.messages
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load export'
  } finally {
    isLoadingExport.value = false
  }
}

async function handleExportDelete(exportId: string) {
  try {
    await chatHistoryService.deleteChatExport(exportId)
    await loadCachedExports()

    if (selectedExport.value?.id === exportId) {
      selectedExport.value = null
      exportMessages.value = []
    }

    uiStore.showToast('success', t('llmExport.exportDeleted'))
  } catch {
    uiStore.showToast('error', t('llmExport.deleteError'))
  }
}

function handleConfigChange(newConfig: FormatConfig) {
  formatConfig.value = newConfig
}

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(formattedOutput.value)
    uiStore.showToast('success', t('llmExport.copiedToClipboard'))
  } catch {
    uiStore.showToast('error', t('llmExport.copyError'))
  }
}

function getFileExtension(): string {
  switch (formatConfig.value.template) {
    case 'xml':
      return 'xml'
    case 'json':
      return 'json'
    case 'markdown':
      return 'md'
    default:
      return 'txt'
  }
}

function getMimeType(): string {
  switch (formatConfig.value.template) {
    case 'xml':
      return 'application/xml;charset=utf-8'
    case 'json':
      return 'application/json;charset=utf-8'
    default:
      return 'text/plain;charset=utf-8'
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_')
}

function downloadAsFile() {
  const chatTitle = sanitizeFilename(selectedExport.value?.chatTitle || 'chat')
  const ext = getFileExtension()
  const blob = new Blob([formattedOutput.value], { type: getMimeType() })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${chatTitle}.${ext}`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="max-w-6xl mx-auto py-8 px-4">
    <!-- Header -->
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {{ t('llmExport.title') }}
      </h1>
      <p class="text-gray-600 dark:text-gray-400">
        {{ t('llmExport.description') }}
      </p>
    </header>

    <!-- Tabs -->
    <div class="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
      <button
        @click="activeTab = 'new'"
        :class="[
          'px-4 py-2 text-sm font-medium transition-colors duration-100 border-b-2 -mb-px',
          activeTab === 'new'
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
        ]"
      >
        {{ t('llmExport.newExport') }}
      </button>
      <button
        @click="activeTab = 'exports'"
        :class="[
          'px-4 py-2 text-sm font-medium transition-colors duration-100 border-b-2 -mb-px',
          activeTab === 'exports'
            ? 'border-blue-600 text-blue-600'
            : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white',
        ]"
      >
        {{ t('llmExport.myExports') }}
        <span
          v-if="cachedExports.length > 0"
          class="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-gray-200 dark:bg-gray-700"
        >
          {{ cachedExports.length }}
        </span>
      </button>
    </div>

    <!-- Error display -->
    <div
      v-if="error"
      class="mb-6 p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
    >
      {{ error }}
    </div>

    <!-- Tab: New Export -->
    <div v-if="activeTab === 'new'" class="space-y-6">
      <!-- Download in progress -->
      <div
        v-if="isDownloading"
        class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
      >
        <div class="text-center">
          <div
            class="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
          ></div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {{ t('llmExport.downloading') }}
          </h3>
          <p class="text-gray-600 dark:text-gray-400 mb-4">
            {{ selectedChat?.title }}
          </p>

          <div class="text-2xl font-bold text-blue-600 mb-2">
            {{ downloadProgress?.fetchedMessages || 0 }}
            <span v-if="downloadProgress?.totalEstimate" class="text-gray-400">
              / ~{{ downloadProgress.totalEstimate }}
            </span>
            <span class="text-base font-normal text-gray-500 ml-1">
              {{ t('llmExport.messages') }}
            </span>
          </div>

          <!-- Flood wait indicator -->
          <FloodWaitIndicator
            :seconds="floodWait.seconds.value"
            :remaining="floodWait.remaining.value"
            :progress="floodWait.progress.value"
          />

          <div class="mt-4 flex items-center justify-center gap-3">
            <button
              v-if="downloadProgress && downloadProgress.fetchedMessages > 0"
              @click="stopAndSaveDownload"
              class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
            >
              {{ t('llmExport.stopAndSave') }}
            </button>
            <button
              @click="cancelDownload"
              class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-100"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Chat selection -->
      <template v-else>
        <ChatSelector
          :chats="chats"
          :is-loading="isLoadingChats"
          :selected-chat="selectedChat"
          @select="handleChatSelect"
        />

        <!-- Download options -->
        <div
          v-if="selectedChat"
          class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            {{ t('llmExport.downloadOptions') }}
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {{ t('llmExport.messageLimit') }}
              </label>
              <input
                v-model.number="downloadLimit"
                type="number"
                min="0"
                :placeholder="t('llmExport.noLimit')"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {{ t('llmExport.fromDate') }}
              </label>
              <input
                v-model="downloadMinDate"
                type="date"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {{ t('llmExport.toDate') }}
              </label>
              <input
                v-model="downloadMaxDate"
                type="date"
                class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
              />
            </div>
          </div>

          <div class="mt-4 flex justify-end">
            <button
              @click="startDownload"
              class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
            >
              {{ t('llmExport.startDownload') }}
            </button>
          </div>
        </div>

        <!-- Info box -->
        <div
          class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800"
        >
          <div class="flex gap-3">
            <span class="text-blue-600">ℹ️</span>
            <div class="text-sm text-blue-800 dark:text-blue-300">
              <p class="mb-1">
                <strong>{{ t('llmExport.infoTitle') }}</strong>
              </p>
              <p class="text-xs text-blue-700 dark:text-blue-400">
                {{ t('llmExport.infoDescription') }}
              </p>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Tab: My Exports -->
    <div v-else-if="activeTab === 'exports'" class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Left column: Exports list -->
      <div class="lg:col-span-1">
        <ExportsList
          :exports="cachedExports"
          :selected-export-id="selectedExport?.id"
          :is-loading="isLoadingExport"
          @select="handleExportSelect"
          @delete="handleExportDelete"
        />
      </div>

      <!-- Right column: Format config + Preview -->
      <div class="lg:col-span-2 space-y-6">
        <template v-if="selectedExport">
          <!-- Format configuration -->
          <FormatConfigPanel :config="formatConfig" @update="handleConfigChange" />

          <!-- Output stats -->
          <div
            class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm"
          >
            <div class="flex gap-4 text-gray-600 dark:text-gray-400">
              <span>{{ outputStats.characters.toLocaleString() }} {{ t('llmExport.chars') }}</span>
              <span>{{ outputStats.lines.toLocaleString() }} {{ t('llmExport.lines') }}</span>
              <span
                >~{{ outputStats.estimatedTokens.toLocaleString() }}
                {{ t('llmExport.tokens') }}</span
              >
            </div>
            <div class="flex gap-2">
              <button
                @click="copyToClipboard"
                class="px-3 py-1.5 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
              >
                {{ t('llmExport.copy') }}
              </button>
              <button
                @click="downloadAsFile"
                class="px-3 py-1.5 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-100"
              >
                {{ t('llmExport.download') }}
              </button>
            </div>
          </div>

          <!-- Live preview -->
          <LivePreview :content="previewOutput" />
        </template>

        <!-- Empty state -->
        <div
          v-else
          class="flex flex-col items-center justify-center py-16 text-center text-gray-500 dark:text-gray-400"
        >
          <div class="text-4xl mb-4">📝</div>
          <p class="text-lg font-medium mb-2">{{ t('llmExport.selectExport') }}</p>
          <p class="text-sm">{{ t('llmExport.selectExportDesc') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
