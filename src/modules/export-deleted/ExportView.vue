<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBackupsStore, useUiStore } from '@/stores'
import { telegramService } from '@/services/telegram/client'
import { backupManager } from '@/services/storage/backup-manager'
import { quotaManager } from '@/services/storage/quota'
import type { ChatInfo, DeletedMessage, ExportConfig } from '@/types'

const router = useRouter()
const backupsStore = useBackupsStore()
const uiStore = useUiStore()

// State
const step = ref<'select-chat' | 'configure' | 'exporting' | 'complete'>('select-chat')
const chats = ref<ChatInfo[]>([])
const searchQuery = ref('')
const selectedChat = ref<ChatInfo | null>(null)
const exportMode = ref<'all' | 'media_only' | 'text_only'>('all')
const isLoading = ref(false)
const error = ref('')

// Computed
const filteredChats = computed(() => {
  const query = searchQuery.value.toLowerCase()
  return chats.value
    .filter((chat) => chat.canExport)
    .filter((chat) => chat.title.toLowerCase().includes(query))
})

const exportableChatsCount = computed(() => chats.value.filter((c) => c.canExport).length)

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

async function startExport() {
  if (!selectedChat.value) return

  step.value = 'exporting'
  error.value = ''

  const config: ExportConfig = {
    chatId: selectedChat.value.id,
    chatTitle: selectedChat.value.title,
    exportMode: exportMode.value,
    storageStrategy: 'indexeddb',
  }

  // Check storage
  const strategy = await quotaManager.determineExportStrategy(100_000_000) // Estimate
  if (strategy.warnUser) {
    uiStore.showToast('warning', 'Large export detected. Consider downloading as ZIP.')
  }

  const messages: DeletedMessage[] = []
  const mediaBlobs = new Map<number, Blob>()

  backupsStore.startExport(0)
  backupsStore.updateExportProgress({ phase: 'fetching_metadata' })

  try {
    // Collect messages
    for await (const msg of telegramService.iterDeletedMessages(config.chatId)) {
      messages.push(msg)

      backupsStore.updateExportProgress({
        processedMessages: messages.length,
        currentMessageId: msg.id,
      })

      // Download media if needed
      if (msg.hasMedia && config.exportMode !== 'text_only') {
        backupsStore.updateExportProgress({ phase: 'downloading_media' })
        const blob = await telegramService.downloadMedia(msg)
        if (blob) {
          mediaBlobs.set(msg.id, blob)
          backupsStore.updateExportProgress({
            exportedMediaMessages: mediaBlobs.size,
          })
        }
      }
    }

    backupsStore.updateExportProgress({
      phase: 'saving',
      totalMessages: messages.length,
    })

    // Create backup
    const backup = await backupManager.createBackup(config, messages, mediaBlobs)
    backupsStore.addBackup(backup)

    backupsStore.completeExport()
    step.value = 'complete'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Export failed'
    backupsStore.setExportError(error.value)
    step.value = 'configure'
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

        <div v-if="error" class="text-red-600 text-sm">
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
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Exporting...</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {{
            backupsStore.currentExport?.phase === 'fetching_metadata'
              ? 'Fetching deleted messages...'
              : backupsStore.currentExport?.phase === 'downloading_media'
                ? 'Downloading media...'
                : backupsStore.currentExport?.phase === 'saving'
                  ? 'Saving to storage...'
                  : 'Processing...'
          }}
        </p>
        <div class="text-2xl font-bold text-blue-600">
          {{ backupsStore.currentExport?.processedMessages ?? 0 }} messages
        </div>
        <div
          v-if="backupsStore.currentExport?.exportedMediaMessages"
          class="text-xs text-gray-500 mt-1"
        >
          {{ backupsStore.currentExport.exportedMediaMessages }} media files downloaded
        </div>
      </div>
    </template>

    <!-- Step 4: Complete -->
    <template v-else-if="step === 'complete'">
      <div class="text-center py-12">
        <div class="text-4xl mb-4">✅</div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Export Complete!</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Successfully exported {{ backupsStore.currentExport?.processedMessages ?? 0 }} messages
          from {{ selectedChat?.title }}
        </p>
        <div class="flex gap-3 justify-center">
          <router-link
            to="/backups"
            class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-150"
          >
            View Backups
          </router-link>
          <button
            @click="
              step = 'select-chat'
              selectedChat = null
            "
            class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-150"
          >
            Export Another
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
