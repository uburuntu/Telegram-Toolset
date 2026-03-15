<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFloodWait } from '@/composables'
import {
  type ChatWithScheduledMessages,
  type ScheduledMessagesProgress,
  scheduledService,
} from '@/services/scheduled/scheduled-service'
import { telegramService } from '@/services/telegram/client'
import { useUiStore } from '@/stores'
import type { ChatInfo } from '@/types'
import { toUserFriendlyError } from '@/utils/error-messages'

const { t } = useI18n()
const uiStore = useUiStore()

// State
const step = ref<'select-mode' | 'select-chat' | 'configure-all' | 'loading' | 'view-messages'>(
  'select-mode',
)
const mode = ref<'single' | 'all'>('single')
const chats = ref<ChatInfo[]>([])
const searchQuery = ref('')
const selectedChat = ref<ChatInfo | null>(null)
const isLoading = ref(false)
const error = ref('')

// Options for "all chats" mode
const chatLimit = ref(100)
const chatLimitOptions = [50, 100, 200, 500]

// Data
const scheduledData = ref<ChatWithScheduledMessages[]>([])
const currentProgress = ref<ScheduledMessagesProgress | null>(null)

// Flood wait tracking (using composable)
const floodWait = useFloodWait()

// Selection for deletion
const selectedMessages = ref<Set<string>>(new Set())

// Computed
const filteredChats = computed(() => {
  const query = searchQuery.value.toLowerCase()
  return chats.value.filter((chat) => chat.title.toLowerCase().includes(query))
})

const totalScheduledMessages = computed(() => {
  return scheduledData.value.reduce((sum, item) => sum + item.messages.length, 0)
})

const chatsWithMessages = computed(() => {
  return scheduledData.value.filter((item) => item.messages.length > 0)
})

const progressPercentage = computed(() => {
  if (!currentProgress.value || currentProgress.value.totalChats === 0) return 0
  return Math.round((currentProgress.value.processedChats / currentProgress.value.totalChats) * 100)
})

const allSelected = computed(() => {
  const allIds = scheduledData.value.flatMap((item) =>
    item.messages.map((msg) => `${item.chat.id}-${msg.id}`),
  )
  return allIds.length > 0 && allIds.every((id) => selectedMessages.value.has(id))
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
  if (scheduledService.isLoading) {
    scheduledService.cancel()
  }
})

// Actions
function selectMode(selectedMode: 'single' | 'all') {
  mode.value = selectedMode
  if (selectedMode === 'single') {
    step.value = 'select-chat'
  } else {
    step.value = 'configure-all'
  }
}

async function startAllChatsScan() {
  await loadAllScheduledMessages()
}

function selectChat(chat: ChatInfo) {
  selectedChat.value = chat
  loadChatScheduledMessages(chat)
}

async function loadChatScheduledMessages(chat: ChatInfo) {
  step.value = 'loading'
  isLoading.value = true
  error.value = ''
  floodWait.reset()

  try {
    const messages = await scheduledService.getScheduledMessagesForChat(
      chat.id,
      floodWait.callbacks,
    )
    scheduledData.value = [
      {
        chat,
        messages: messages.map((msg) => ({ ...msg, chatTitle: chat.title })),
      },
    ]
    step.value = 'view-messages'
  } catch (e) {
    const friendlyError = toUserFriendlyError(e)
    error.value = friendlyError.message
    step.value = 'select-chat'
  } finally {
    isLoading.value = false
    floodWait.reset()
  }
}

async function loadAllScheduledMessages() {
  step.value = 'loading'
  error.value = ''
  currentProgress.value = null
  floodWait.reset()

  try {
    const results = await scheduledService.getAllScheduledMessages(
      {
        onProgress: (progress) => {
          currentProgress.value = progress
        },
        onError: (err, chatId) => {
          console.warn(`Failed to fetch scheduled messages for chat ${chatId}:`, err)
        },
        ...floodWait.callbacks,
      },
      { chatLimit: chatLimit.value },
    )

    scheduledData.value = results
    step.value = 'view-messages'
  } catch (e) {
    if ((e as Error).message === 'Operation cancelled') {
      uiStore.showToast('info', t('scheduled.cancelled'))
      step.value = 'configure-all'
    } else {
      const friendlyError = toUserFriendlyError(e)
      error.value = friendlyError.message
      step.value = 'configure-all'
    }
  } finally {
    currentProgress.value = null
    floodWait.reset()
  }
}

function goBack() {
  if (step.value === 'select-chat') {
    step.value = 'select-mode'
    selectedChat.value = null
  } else if (step.value === 'configure-all') {
    step.value = 'select-mode'
  } else if (step.value === 'view-messages') {
    scheduledData.value = []
    selectedMessages.value.clear()
    if (mode.value === 'single') {
      step.value = 'select-chat'
    } else {
      step.value = 'configure-all'
    }
  } else if (step.value === 'loading') {
    scheduledService.cancel()
    step.value = mode.value === 'single' ? 'select-chat' : 'configure-all'
  }
}

function toggleMessageSelection(chatId: bigint, messageId: number) {
  const key = `${chatId}-${messageId}`
  if (selectedMessages.value.has(key)) {
    selectedMessages.value.delete(key)
  } else {
    selectedMessages.value.add(key)
  }
}

function toggleAllSelection() {
  if (allSelected.value) {
    selectedMessages.value.clear()
  } else {
    scheduledData.value.forEach((item) => {
      item.messages.forEach((msg) => {
        selectedMessages.value.add(`${item.chat.id}-${msg.id}`)
      })
    })
  }
}

async function deleteSelectedMessages() {
  if (selectedMessages.value.size === 0) return

  const confirmed = confirm(t('scheduled.confirmDelete', { count: selectedMessages.value.size }))
  if (!confirmed) return

  isLoading.value = true

  try {
    // Group messages by chat
    const messagesByChat = new Map<bigint, number[]>()

    for (const key of selectedMessages.value) {
      const [chatIdStr, msgIdStr] = key.split('-')
      const chatId = BigInt(chatIdStr!)
      const msgId = parseInt(msgIdStr!, 10)

      if (!messagesByChat.has(chatId)) {
        messagesByChat.set(chatId, [])
      }
      messagesByChat.get(chatId)!.push(msgId)
    }

    // Delete from each chat
    for (const [chatId, messageIds] of messagesByChat) {
      await scheduledService.deleteScheduledMessages(chatId, messageIds)
    }

    // Remove deleted messages from local state
    scheduledData.value = scheduledData.value
      .map((item) => ({
        ...item,
        messages: item.messages.filter(
          (msg) => !selectedMessages.value.has(`${item.chat.id}-${msg.id}`),
        ),
      }))
      .filter((item) => item.messages.length > 0)

    selectedMessages.value.clear()
    uiStore.showToast('success', t('scheduled.deleteSuccess'))
  } catch (e) {
    const friendlyError = toUserFriendlyError(e)
    uiStore.showToast('error', friendlyError.message)
  } finally {
    isLoading.value = false
  }
}

function exportToJson() {
  scheduledService.exportToJson(scheduledData.value)
  uiStore.showToast('success', t('scheduled.exportSuccess'))
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatScheduledDate(date: Date): string {
  return scheduledService.formatScheduledDate(date)
}
</script>

<template>
  <div class="max-w-2xl mx-auto py-8 px-4">
    <!-- Step 1: Select Mode -->
    <template v-if="step === 'select-mode'">
      <header class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('scheduled.title') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">
          {{ t('scheduled.description') }}
        </p>
      </header>

      <div class="space-y-3">
        <button
          @click="selectMode('single')"
          class="flex items-center gap-4 w-full p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow hover:border-gray-300 dark:hover:border-gray-700 transition-all duration-100 text-left"
        >
          <div
            class="w-12 h-12 flex items-center justify-center bg-blue-100 dark:bg-blue-900/30 rounded-lg text-2xl"
          >
            💬
          </div>
          <div class="flex-1">
            <div class="font-medium text-gray-900 dark:text-white">
              {{ t('scheduled.singleChat') }}
            </div>
            <div class="text-sm text-gray-500">
              {{ t('scheduled.singleChatDesc') }}
            </div>
          </div>
        </button>

        <button
          @click="selectMode('all')"
          class="flex items-center gap-4 w-full p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow hover:border-gray-300 dark:hover:border-gray-700 transition-all duration-100 text-left"
        >
          <div
            class="w-12 h-12 flex items-center justify-center bg-purple-100 dark:bg-purple-900/30 rounded-lg text-2xl"
          >
            📋
          </div>
          <div class="flex-1">
            <div class="font-medium text-gray-900 dark:text-white">
              {{ t('scheduled.allChats') }}
            </div>
            <div class="text-sm text-gray-500">
              {{ t('scheduled.allChatsDesc') }}
            </div>
          </div>
        </button>
      </div>
    </template>

    <!-- Step 2: Select Chat (single mode) -->
    <template v-else-if="step === 'select-chat'">
      <header class="mb-6">
        <button
          @click="goBack"
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-100"
        >
          ← {{ t('common.back') }}
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('scheduled.selectChat') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">
          {{ t('scheduled.selectChatDesc') }}
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
            {{
              chat.type === 'channel'
                ? '📢'
                : chat.type === 'supergroup'
                  ? '👥'
                  : chat.type === 'group'
                    ? '💬'
                    : '👤'
            }}
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

    <!-- Configure All Chats Scan -->
    <template v-else-if="step === 'configure-all'">
      <header class="mb-6">
        <button
          @click="goBack"
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-100"
        >
          ← {{ t('common.back') }}
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('scheduled.configureScan') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">
          {{ t('scheduled.configureScanDesc') }}
        </p>
      </header>

      <div class="space-y-4">
        <!-- Chat limit selection -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {{ t('scheduled.chatLimit') }}
          </label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="limit in chatLimitOptions"
              :key="limit"
              @click="chatLimit = limit"
              :class="[
                'px-4 py-2 text-sm font-medium rounded-md transition-colors duration-100',
                chatLimit === limit
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
              ]"
            >
              {{ limit }}
            </button>
          </div>
          <p class="mt-2 text-xs text-gray-500">
            {{ t('scheduled.chatLimitHint') }}
          </p>
        </div>

        <!-- Info box -->
        <div
          class="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800"
        >
          <div class="flex gap-3">
            <span class="text-blue-600">ℹ️</span>
            <div class="text-sm text-blue-800 dark:text-blue-300">
              <p>{{ t('scheduled.scanInfo') }}</p>
            </div>
          </div>
        </div>

        <!-- Error display -->
        <div
          v-if="error"
          class="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
        >
          <div class="flex gap-3">
            <span>❌</span>
            <div class="text-sm text-red-800 dark:text-red-300">
              {{ error }}
            </div>
          </div>
        </div>

        <button
          @click="startAllChatsScan"
          class="w-full px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
        >
          {{ t('scheduled.startScan') }}
        </button>
      </div>
    </template>

    <!-- Loading State -->
    <template v-else-if="step === 'loading'">
      <header class="mb-6">
        <button
          @click="goBack"
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-100"
        >
          ← {{ t('common.cancel') }}
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('scheduled.loading') }}
        </h1>
      </header>

      <div class="text-center py-12">
        <div
          class="animate-spin w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
        ></div>

        <!-- Flood wait indicator -->
        <div class="mb-4">
          <FloodWaitIndicator
            :seconds="floodWait.seconds.value"
            :remaining="floodWait.remaining.value"
            :progress="floodWait.progress.value"
          />
        </div>

        <template v-if="currentProgress">
          <p class="text-gray-900 dark:text-white font-medium mb-2">
            {{ currentProgress.currentChat || t('scheduled.scanning') }}
          </p>
          <p class="text-sm text-gray-500 mb-4">
            {{
              t('scheduled.progressChats', {
                current: currentProgress.processedChats,
                total: currentProgress.totalChats,
              })
            }}
          </p>

          <!-- Progress bar -->
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-2">
            <div
              class="bg-blue-600 h-2 rounded-full transition-all duration-300"
              :style="{ width: `${progressPercentage}%` }"
            ></div>
          </div>

          <p class="text-sm text-gray-500">
            {{ t('scheduled.foundMessages', { count: currentProgress.totalMessages }) }}
          </p>
        </template>

        <template v-else>
          <p class="text-gray-600 dark:text-gray-400">{{ t('scheduled.loadingMessages') }}</p>
        </template>
      </div>
    </template>

    <!-- View Messages -->
    <template v-else-if="step === 'view-messages'">
      <header class="mb-6">
        <button
          @click="goBack"
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-100"
        >
          ← {{ t('common.back') }}
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('scheduled.results') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">
          {{ t('scheduled.foundTotal', { count: totalScheduledMessages }) }}
        </p>
      </header>

      <!-- No messages -->
      <div v-if="totalScheduledMessages === 0" class="text-center py-12">
        <div class="text-4xl mb-4">📭</div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {{ t('scheduled.noMessages') }}
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ mode === 'all' ? t('scheduled.noMessagesDescAll') : t('scheduled.noMessagesDesc') }}
        </p>
      </div>

      <!-- Messages list -->
      <template v-else>
        <!-- Actions bar -->
        <div
          class="flex items-center justify-between mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
        >
          <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              :checked="allSelected"
              @change="toggleAllSelection"
              class="rounded text-blue-600"
            />
            {{ t('scheduled.selectAll') }}
          </label>

          <div class="flex gap-2">
            <button
              @click="exportToJson"
              class="px-3 py-1.5 text-sm font-medium rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-100"
            >
              {{ t('scheduled.exportJson') }}
            </button>
            <button
              v-if="selectedMessages.size > 0"
              @click="deleteSelectedMessages"
              :disabled="isLoading"
              class="px-3 py-1.5 text-sm font-medium rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors duration-100"
            >
              {{ t('scheduled.deleteSelected', { count: selectedMessages.size }) }}
            </button>
          </div>
        </div>

        <!-- Messages grouped by chat -->
        <div class="space-y-6">
          <div
            v-for="item in chatsWithMessages"
            :key="item.chat.id.toString()"
            class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
          >
            <!-- Chat header -->
            <div
              class="px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 flex items-center justify-center bg-gray-200 dark:bg-gray-700 rounded-lg text-lg"
                >
                  {{
                    item.chat.type === 'channel'
                      ? '📢'
                      : item.chat.type === 'supergroup'
                        ? '👥'
                        : item.chat.type === 'group'
                          ? '💬'
                          : '👤'
                  }}
                </div>
                <div>
                  <div class="font-medium text-gray-900 dark:text-white">
                    {{ item.chat.title }}
                  </div>
                  <div class="text-xs text-gray-500">
                    {{ t('scheduled.messageCount', { count: item.messages.length }) }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Messages -->
            <div class="divide-y divide-gray-100 dark:divide-gray-800">
              <div
                v-for="msg in item.messages"
                :key="msg.id"
                class="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors duration-100"
              >
                <div class="flex items-start gap-3">
                  <input
                    type="checkbox"
                    :checked="selectedMessages.has(`${item.chat.id}-${msg.id}`)"
                    @change="toggleMessageSelection(item.chat.id, msg.id)"
                    class="mt-1 rounded text-blue-600"
                  />
                  <div class="flex-1 min-w-0">
                    <!-- Message content -->
                    <div
                      v-if="msg.text"
                      class="text-sm text-gray-900 dark:text-white mb-2 whitespace-pre-wrap"
                    >
                      {{ msg.text.length > 200 ? msg.text.slice(0, 200) + '...' : msg.text }}
                    </div>

                    <!-- Media indicator -->
                    <div
                      v-if="msg.hasMedia"
                      class="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-400 mb-2"
                    >
                      <span>📎</span>
                      <span>{{ msg.mediaType || 'media' }}</span>
                      <span v-if="msg.mediaFilename" class="truncate max-w-32">{{
                        msg.mediaFilename
                      }}</span>
                    </div>

                    <!-- Scheduled date -->
                    <div class="flex items-center gap-3 text-xs text-gray-500">
                      <span class="flex items-center gap-1">
                        <span>🕐</span>
                        {{ formatDate(msg.scheduledDate) }}
                      </span>
                      <span
                        :class="[
                          'px-2 py-0.5 rounded-full font-medium',
                          msg.scheduledDate.getTime() < Date.now()
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                            : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
                        ]"
                      >
                        {{ formatScheduledDate(msg.scheduledDate) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
