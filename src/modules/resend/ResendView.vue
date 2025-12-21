<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBackupsStore, useUiStore } from '@/stores'
import { telegramService } from '@/services/telegram/client'
import { backupManager } from '@/services/storage/backup-manager'
import type { ChatInfo, Backup } from '@/types'

const router = useRouter()
const backupsStore = useBackupsStore()
const uiStore = useUiStore()

// State
const step = ref<'select-backup' | 'select-target' | 'configure' | 'sending' | 'complete'>(
  'select-backup'
)
const chats = ref<ChatInfo[]>([])
const searchQuery = ref('')
const selectedBackup = ref<Backup | null>(null)
const selectedTarget = ref<ChatInfo | null>(null)
const isLoading = ref(false)
const error = ref('')

// Config options
const includeMedia = ref(true)
const includeText = ref(true)
const showSenderName = ref(true)
const showDate = ref(true)
const enableBatching = ref(false)

// Progress
const sentCount = ref(0)
const totalCount = ref(0)

// Computed
const filteredChats = computed(() => {
  const query = searchQuery.value.toLowerCase()
  return chats.value
    .filter((chat) => chat.canSend)
    .filter((chat) => chat.title.toLowerCase().includes(query))
})

// Lifecycle
onMounted(async () => {
  backupsStore.setLoading(true)
  try {
    const backups = await backupManager.listBackups()
    backupsStore.setBackups(backups)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load backups'
  } finally {
    backupsStore.setLoading(false)
  }
})

// Actions
function selectBackup(backup: Backup) {
  selectedBackup.value = backup
  step.value = 'select-target'
  loadChats()
}

async function loadChats() {
  isLoading.value = true
  try {
    chats.value = await telegramService.getDialogs(100)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load chats'
  } finally {
    isLoading.value = false
  }
}

function selectTarget(chat: ChatInfo) {
  selectedTarget.value = chat
  step.value = 'configure'
}

function goBack() {
  error.value = ''
  if (step.value === 'select-target') {
    step.value = 'select-backup'
    selectedBackup.value = null
  } else if (step.value === 'configure') {
    step.value = 'select-target'
    selectedTarget.value = null
  } else if (step.value === 'complete') {
    router.push('/')
  }
}

async function startResend() {
  if (!selectedBackup.value || !selectedTarget.value) return

  step.value = 'sending'
  error.value = ''
  sentCount.value = 0

  try {
    const backup = await backupManager.getBackup(selectedBackup.value.id)
    if (!backup) {
      throw new Error('Backup not found')
    }

    totalCount.value = backup.messages.length

    // TODO: Implement actual resend logic using telegramService
    for (let i = 0; i < backup.messages.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      sentCount.value++
    }

    step.value = 'complete'
    uiStore.showToast('success', `Successfully sent ${sentCount.value} messages!`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Resend failed'
    step.value = 'configure'
  }
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}
</script>

<template>
  <div class="max-w-2xl mx-auto py-8 px-4">
    <!-- Step 1: Select Backup -->
    <template v-if="step === 'select-backup'">
      <header class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Resend Messages</h1>
        <p class="text-gray-600 dark:text-gray-400">Select a backup to resend</p>
      </header>

      <div v-if="backupsStore.isLoading" class="text-center py-12">
        <div
          class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
        ></div>
        <p class="text-gray-600 dark:text-gray-400">Loading backups...</p>
      </div>

      <div v-else-if="backupsStore.backupCount === 0" class="text-center py-12">
        <div class="text-3xl mb-3">📭</div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          No backups available
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">Export some messages first</p>
        <router-link
          to="/export"
          class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-150"
        >
          Create Export
        </router-link>
      </div>

      <div v-else class="space-y-2">
        <button
          v-for="backup in backupsStore.backups"
          :key="backup.id"
          @click="selectBackup(backup)"
          class="flex items-center gap-3 w-full p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow hover:border-gray-300 dark:hover:border-gray-700 transition-all duration-150 text-left"
        >
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-900 dark:text-white truncate">
              {{ backup.chatTitle }}
            </div>
            <div class="text-xs text-gray-500">
              {{ formatDate(backup.createdAt) }} • {{ backup.messageCount }} messages •
              {{ formatBytes(backup.storageSize) }}
            </div>
          </div>
          <span class="text-gray-400">→</span>
        </button>
      </div>
    </template>

    <!-- Step 2: Select Target Chat -->
    <template v-else-if="step === 'select-target'">
      <header class="mb-6">
        <button
          @click="goBack"
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-150"
        >
          ← Back
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Select Target Chat</h1>
        <p class="text-gray-600 dark:text-gray-400">
          Choose where to send messages from: <strong>{{ selectedBackup?.chatTitle }}</strong>
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
          class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"
        ></div>
      </div>

      <div v-else class="space-y-2">
        <button
          v-for="chat in filteredChats"
          :key="chat.id.toString()"
          @click="selectTarget(chat)"
          class="flex items-center gap-3 w-full p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow hover:border-gray-300 dark:hover:border-gray-700 transition-all duration-150 text-left"
        >
          <div
            class="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg text-xl"
          >
            {{ chat.type === 'user' ? '👤' : chat.type === 'channel' ? '📢' : '👥' }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-900 dark:text-white truncate">
              {{ chat.title }}
            </div>
            <div class="text-xs text-gray-500">
              {{ chat.type }}
            </div>
          </div>
        </button>
      </div>
    </template>

    <!-- Step 3: Configure -->
    <template v-else-if="step === 'configure'">
      <header class="mb-6">
        <button
          @click="goBack"
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-150"
        >
          ← Back
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Configure Resend</h1>
        <p class="text-gray-600 dark:text-gray-400">
          Sending {{ selectedBackup?.messageCount }} messages to:
          <strong>{{ selectedTarget?.title }}</strong>
        </p>
      </header>

      <div class="space-y-3">
        <label
          class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-150"
        >
          <input v-model="includeMedia" type="checkbox" class="rounded text-blue-600" />
          <span class="text-sm text-gray-900 dark:text-white">Include media files</span>
        </label>

        <label
          class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-150"
        >
          <input v-model="includeText" type="checkbox" class="rounded text-blue-600" />
          <span class="text-sm text-gray-900 dark:text-white">Include text content</span>
        </label>

        <label
          class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-150"
        >
          <input v-model="showSenderName" type="checkbox" class="rounded text-blue-600" />
          <span class="text-sm text-gray-900 dark:text-white">Show original sender name</span>
        </label>

        <label
          class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-150"
        >
          <input v-model="showDate" type="checkbox" class="rounded text-blue-600" />
          <span class="text-sm text-gray-900 dark:text-white">Show original date</span>
        </label>

        <label
          class="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-150"
        >
          <input v-model="enableBatching" type="checkbox" class="rounded text-blue-600" />
          <span class="text-sm text-gray-900 dark:text-white">Batch short messages together</span>
        </label>

        <div v-if="error" class="text-red-600 text-sm">
          {{ error }}
        </div>

        <button
          @click="startResend"
          class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-150 mt-4"
        >
          Start Resending
        </button>
      </div>
    </template>

    <!-- Step 4: Sending -->
    <template v-else-if="step === 'sending'">
      <div class="text-center py-12">
        <div
          class="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-5"
        ></div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Sending Messages...
        </h2>
        <div class="text-2xl font-bold text-blue-600 mb-3">{{ sentCount }} / {{ totalCount }}</div>
        <div
          class="w-full max-w-xs mx-auto h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
        >
          <div
            class="h-full bg-blue-600 transition-all duration-150"
            :style="{ width: `${(sentCount / totalCount) * 100}%` }"
          ></div>
        </div>
      </div>
    </template>

    <!-- Step 5: Complete -->
    <template v-else-if="step === 'complete'">
      <div class="text-center py-12">
        <div class="text-4xl mb-4">✅</div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Resend Complete!</h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Successfully sent {{ sentCount }} messages to {{ selectedTarget?.title }}
        </p>
        <div class="flex gap-3 justify-center">
          <router-link
            to="/"
            class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-150"
          >
            Back to Home
          </router-link>
          <button
            @click="step = 'select-backup'"
            class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-150"
          >
            Resend Another
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
