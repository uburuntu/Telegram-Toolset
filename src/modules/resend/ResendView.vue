<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useBackupsStore, useUiStore } from '@/stores'
import { telegramService } from '@/services/telegram/client'
import { backupManager } from '@/services/storage/backup-manager'
import { resendService } from '@/services/resend/resend-service'
import { getBrowserTimezone, getTimezoneLabel } from '@/types/backup'
import type { ChatInfo, Backup, ResendConfig, ExportProgress, DeletedMessage } from '@/types'

const { t } = useI18n()
const router = useRouter()
const backupsStore = useBackupsStore()
const uiStore = useUiStore()

// State
const step = ref<
  'select-backup' | 'select-target' | 'configure' | 'confirm' | 'sending' | 'complete'
>('select-backup')
const showConfirmDialog = ref(false)
const chats = ref<ChatInfo[]>([])
const searchQuery = ref('')
const selectedBackup = ref<Backup | null>(null)
const selectedTarget = ref<ChatInfo | null>(null)
const isLoading = ref(false)
const error = ref('')

// Config options (matching ResendConfig type)
const includeMedia = ref(true)
const includeText = ref(true)
const showSenderName = ref(true)
const showSenderUsername = ref(true)
const showDate = ref(true)
const showReplyLink = ref(true)
const useHiddenReplyLinks = ref(true)
// Auto-detect timezone from browser
const timezone = ref(getBrowserTimezone())
const useCustomTimezone = ref(false)
const enableBatching = ref(false)
const batchMaxMessages = ref(7)
const batchTimeWindowMinutes = ref(10)
const batchMaxMessageLength = ref(150)

// Progress tracking
const currentProgress = ref<ExportProgress | null>(null)
const floodWaitSeconds = ref(0)
const floodWaitRemaining = ref(0)

// Preview sample messages
const sampleMessages = ref<DeletedMessage[]>([])

// Generate preview HTML based on current config
const previewHtml = computed(() => {
  if (sampleMessages.value.length === 0) return ''

  const config: Partial<ResendConfig> = {
    showSenderName: showSenderName.value,
    showSenderUsername: showSenderUsername.value,
    showDate: showDate.value,
    showReplyLink: showReplyLink.value,
    useHiddenReplyLinks: useHiddenReplyLinks.value,
    timezone: timezone.value,
  }

  // Generate preview for first sample message
  const msg = sampleMessages.value[0]
  if (!msg) return ''

  return resendService.generatePreview(msg, config)
})

// Load sample messages when backup is selected
watch(
  () => selectedBackup.value,
  async (backup) => {
    if (!backup) {
      sampleMessages.value = []
      return
    }

    try {
      const fullBackup = await backupManager.getBackup(backup.id)
      if (fullBackup && fullBackup.messages.length > 0) {
        // Pick up to 2 sample messages with text
        const samples = fullBackup.messages.filter((m) => m.text || m.senderName).slice(0, 2)
        sampleMessages.value = samples.length > 0 ? samples : fullBackup.messages.slice(0, 2)
      }
    } catch {
      // Silently ignore - preview is optional
    }
  },
  { immediate: true }
)

// Computed
const filteredChats = computed(() => {
  const query = searchQuery.value.toLowerCase()
  return chats.value
    .filter((chat) => chat.canSend)
    .filter((chat) => chat.title.toLowerCase().includes(query))
})

const progressPercentage = computed(() => {
  if (!currentProgress.value || currentProgress.value.totalMessages === 0) return 0
  return Math.round(
    (currentProgress.value.processedMessages / currentProgress.value.totalMessages) * 100
  )
})

const sentCount = computed(() => {
  if (!currentProgress.value) return 0
  return currentProgress.value.exportedTextMessages + currentProgress.value.exportedMediaMessages
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

onUnmounted(() => {
  // Cancel any in-progress resend on unmount
  if (resendService.isResending) {
    resendService.cancel()
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
  } else if (step.value === 'confirm') {
    step.value = 'configure'
    showConfirmDialog.value = false
  } else if (step.value === 'complete') {
    router.push('/')
  }
}

function showConfirmation() {
  step.value = 'confirm'
  showConfirmDialog.value = true
}

function confirmAndStart() {
  showConfirmDialog.value = false
  startResend()
}

function cancelResend() {
  resendService.cancel()
}

async function startResend() {
  if (!selectedBackup.value || !selectedTarget.value) return

  step.value = 'sending'
  error.value = ''
  currentProgress.value = null
  floodWaitSeconds.value = 0

  try {
    // Load full backup with messages
    const backup = await backupManager.getBackup(selectedBackup.value.id)
    if (!backup) {
      throw new Error('Backup not found')
    }

    // Build config
    const config: ResendConfig = {
      targetChatId: selectedTarget.value.id,
      targetChatTitle: selectedTarget.value.title,
      backupId: selectedBackup.value.id,
      includeMedia: includeMedia.value,
      includeText: includeText.value,
      showSenderName: showSenderName.value,
      showSenderUsername: showSenderUsername.value,
      showDate: showDate.value,
      showReplyLink: showReplyLink.value,
      useHiddenReplyLinks: useHiddenReplyLinks.value,
      timezone: timezone.value,
      enableBatching: enableBatching.value,
      batchMaxMessages: batchMaxMessages.value,
      batchTimeWindowMinutes: batchTimeWindowMinutes.value,
      batchMaxMessageLength: batchMaxMessageLength.value,
    }

    // Start resend with progress tracking
    const result = await resendService.resendMessages(backup.messages, backup.mediaBlobs, config, {
      onProgress: (progress) => {
        currentProgress.value = { ...progress }
      },
      onFloodWait: (seconds) => {
        floodWaitSeconds.value = seconds
        floodWaitRemaining.value = seconds
        uiStore.showToast('warning', t('export.rateLimited', { seconds }))
      },
      onFloodWaitCountdown: (remaining) => {
        floodWaitRemaining.value = remaining
        if (remaining === 0) {
          floodWaitSeconds.value = 0
        }
      },
      onError: (err, messageId) => {
        console.error(`Failed to send message ${messageId}:`, err)
      },
    })

    step.value = 'complete'
    uiStore.showToast(
      'success',
      t('resend.successMessage', { count: result.sentCount, chat: selectedTarget.value.title })
    )
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      uiStore.showToast('info', t('export.cancelled'))
      step.value = 'configure'
    } else {
      error.value = e instanceof Error ? e.message : 'Resend failed'
      step.value = 'configure'
    }
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
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('resend.title') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('resend.selectBackup') }}</p>
      </header>

      <div v-if="backupsStore.isLoading" class="text-center py-12">
        <div
          class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
        ></div>
        <p class="text-gray-600 dark:text-gray-400">{{ t('resend.loadingBackups') }}</p>
      </div>

      <div v-else-if="backupsStore.backupCount === 0" class="text-center py-12">
        <div class="text-3xl mb-3">📭</div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {{ t('resend.noBackups') }}
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">{{ t('resend.noBackupsText') }}</p>
        <router-link
          to="/export"
          class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
        >
          {{ t('resend.createExport') }}
        </router-link>
      </div>

      <div v-else class="space-y-2">
        <button
          v-for="backup in backupsStore.backups"
          :key="backup.id"
          @click="selectBackup(backup)"
          class="flex items-center gap-3 w-full p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow hover:border-gray-300 dark:hover:border-gray-700 transition-all duration-100 text-left"
        >
          <div class="flex-1 min-w-0">
            <div class="font-medium text-gray-900 dark:text-white truncate">
              {{ backup.chatTitle }}
            </div>
            <div class="text-xs text-gray-500">
              {{ formatDate(backup.createdAt) }} • {{ backup.messageCount }} •
              {{ formatBytes(backup.storageSize) }}
              <span v-if="backup.mediaCount > 0" class="text-blue-600">
                • {{ backup.mediaCount }} media
              </span>
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
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-100"
        >
          ← {{ t('common.back') }}
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('resend.selectTarget') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">
          {{ t('resend.selectTargetDesc') }} <strong>{{ selectedBackup?.chatTitle }}</strong>
        </p>
      </header>

      <div class="mb-4">
        <input
          v-model="searchQuery"
          type="search"
          :placeholder="t('common.search')"
          class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
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
          class="flex items-center gap-3 w-full p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow hover:border-gray-300 dark:hover:border-gray-700 transition-all duration-100 text-left"
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
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-100"
        >
          ← {{ t('common.back') }}
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('resend.configure') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">
          {{ t('resend.sendingCount', { count: selectedBackup?.messageCount }) }}
          <strong>{{ selectedTarget?.title }}</strong>
        </p>
      </header>

      <div class="space-y-4">
        <!-- Content Options -->
        <div
          class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {{ t('resend.content') }}
          </h3>
          <div class="space-y-2">
            <label class="flex items-center gap-3">
              <input v-model="includeMedia" type="checkbox" class="rounded text-blue-600" />
              <span class="text-sm text-gray-900 dark:text-white">{{
                t('resend.includeMedia')
              }}</span>
            </label>
            <label class="flex items-center gap-3">
              <input v-model="includeText" type="checkbox" class="rounded text-blue-600" />
              <span class="text-sm text-gray-900 dark:text-white">{{
                t('resend.includeText')
              }}</span>
            </label>
          </div>
        </div>

        <!-- Header Options -->
        <div
          class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {{ t('resend.header') }}
          </h3>
          <div class="space-y-2">
            <label class="flex items-center gap-3">
              <input v-model="showSenderName" type="checkbox" class="rounded text-blue-600" />
              <span class="text-sm text-gray-900 dark:text-white">{{
                t('resend.showSenderName')
              }}</span>
            </label>
            <label class="flex items-center gap-3">
              <input v-model="showSenderUsername" type="checkbox" class="rounded text-blue-600" />
              <span class="text-sm text-gray-900 dark:text-white">{{
                t('resend.showUsername')
              }}</span>
            </label>
            <label class="flex items-center gap-3">
              <input v-model="showDate" type="checkbox" class="rounded text-blue-600" />
              <span class="text-sm text-gray-900 dark:text-white">{{ t('resend.showDate') }}</span>
            </label>
            <label class="flex items-center gap-3">
              <input v-model="showReplyLink" type="checkbox" class="rounded text-blue-600" />
              <span class="text-sm text-gray-900 dark:text-white">{{
                t('resend.showReplyLink')
              }}</span>
            </label>
            <label v-if="showReplyLink" class="flex items-center gap-3 cursor-pointer ml-6">
              <input v-model="useHiddenReplyLinks" type="checkbox" class="rounded text-blue-600" />
              <span class="text-sm text-gray-600 dark:text-gray-400">{{
                t('resend.hiddenReplyLink')
              }}</span>
            </label>
          </div>
        </div>

        <!-- Timezone -->
        <div
          class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {{ t('resend.timezone') }}
          </h3>
          <div class="space-y-3">
            <div class="flex items-center gap-2 text-sm">
              <span class="text-gray-600 dark:text-gray-400">{{ t('resend.detected') }}:</span>
              <span class="font-medium text-gray-900 dark:text-white">
                {{ getTimezoneLabel(getBrowserTimezone()) }}
              </span>
              <span class="text-xs text-gray-500">({{ getBrowserTimezone() }})</span>
            </div>
            <label class="flex items-center gap-3">
              <input v-model="useCustomTimezone" type="checkbox" class="rounded text-blue-600" />
              <span class="text-sm text-gray-900 dark:text-white">{{
                t('resend.useCustomTimezone')
              }}</span>
            </label>
            <div v-if="useCustomTimezone" class="ml-6">
              <select
                v-model="timezone"
                class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
              >
                <optgroup label="Common Timezones">
                  <option value="UTC">UTC</option>
                  <option value="Europe/London">London (GMT/BST)</option>
                  <option value="Europe/Paris">Paris (CET/CEST)</option>
                  <option value="Europe/Moscow">Moscow (MSK)</option>
                  <option value="America/New_York">New York (EST/EDT)</option>
                  <option value="America/Los_Angeles">Los Angeles (PST/PDT)</option>
                  <option value="Asia/Tokyo">Tokyo (JST)</option>
                  <option value="Asia/Shanghai">Shanghai (CST)</option>
                  <option value="Asia/Dubai">Dubai (GST)</option>
                  <option value="Australia/Sydney">Sydney (AEST/AEDT)</option>
                </optgroup>
              </select>
            </div>
          </div>
        </div>

        <!-- Batching Options -->
        <div
          class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {{ t('resend.batching') }}
          </h3>
          <div class="space-y-3">
            <label class="flex items-center gap-3">
              <input v-model="enableBatching" type="checkbox" class="rounded text-blue-600" />
              <span class="text-sm text-gray-900 dark:text-white">{{
                t('resend.mergeBatching')
              }}</span>
            </label>
            <div
              v-if="enableBatching"
              class="ml-6 space-y-2 text-sm text-gray-600 dark:text-gray-400"
            >
              <div class="flex items-center gap-2">
                <span>{{ t('resend.batchMaxMessages') }}:</span>
                <input
                  v-model.number="batchMaxMessages"
                  type="number"
                  min="2"
                  max="20"
                  class="w-16 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-center"
                />
              </div>
              <div class="flex items-center gap-2">
                <span>{{ t('resend.batchTimeWindow') }}:</span>
                <input
                  v-model.number="batchTimeWindowMinutes"
                  type="number"
                  min="1"
                  max="60"
                  class="w-16 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-center"
                />
              </div>
              <div class="flex items-center gap-2">
                <span>{{ t('resend.batchMaxLength') }}:</span>
                <input
                  v-model.number="batchMaxMessageLength"
                  type="number"
                  min="50"
                  max="500"
                  class="w-20 px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-center"
                />
                <span>{{ t('resend.chars') }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Live Preview -->
        <div
          v-if="previewHtml && showDate"
          class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            {{ t('resend.preview') }}
          </h3>
          <div
            class="p-3 bg-gray-50 dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700"
          >
            <div
              class="text-sm text-gray-900 dark:text-white whitespace-pre-wrap break-words"
              v-html="previewHtml"
            ></div>
          </div>
          <p class="text-xs text-gray-500 mt-2">{{ t('resend.previewHint') }}</p>
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

    <!-- Step 4: Confirm -->
    <template v-else-if="step === 'confirm'">
      <header class="mb-6">
        <button
          @click="goBack"
          class="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3 transition-colors duration-100"
        >
          ← {{ t('common.back') }}
        </button>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {{ t('resend.confirmTitle') }}
        </h1>
        <p class="text-gray-600 dark:text-gray-400">{{ t('resend.confirmSubtitle') }}</p>
      </header>

      <div class="space-y-4">
        <!-- Summary card -->
        <div
          class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
        >
          <div class="space-y-3">
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600 dark:text-gray-400"
                >{{ t('resend.fromBackup') }}:</span
              >
              <span class="font-medium text-gray-900 dark:text-white">
                {{ selectedBackup?.chatTitle }}
              </span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600 dark:text-gray-400"
                >{{ t('resend.sendTo') }}:</span
              >
              <span class="font-medium text-gray-900 dark:text-white">
                {{ selectedTarget?.title }}
              </span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-600 dark:text-gray-400"
                >{{ t('export.messages', { count: selectedBackup?.messageCount }) }}:</span
              >
              <span class="font-medium text-gray-900 dark:text-white">
                {{ selectedBackup?.messageCount }}
              </span>
            </div>
            <div v-if="selectedBackup?.mediaCount" class="flex justify-between items-center">
              <span class="text-sm text-gray-600 dark:text-gray-400"
                >{{ t('resend.mediaFilesCount') }}:</span
              >
              <span class="font-medium text-gray-900 dark:text-white">
                {{ selectedBackup.mediaCount }}
              </span>
            </div>
          </div>
        </div>

        <!-- Configuration summary -->
        <div
          class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            {{ t('resend.configuration') }}
          </h3>
          <div class="text-xs text-gray-600 dark:text-gray-400 space-y-1">
            <div v-if="includeMedia && selectedBackup?.mediaCount">
              ✓ {{ t('resend.configIncludeMedia') }}
            </div>
            <div v-if="includeText">✓ {{ t('resend.configIncludeText') }}</div>
            <div v-if="showSenderName">✓ {{ t('resend.configShowSender') }}</div>
            <div v-if="showDate">✓ {{ t('resend.configShowDate') }}</div>
            <div v-if="enableBatching">✓ {{ t('resend.configBatching') }}</div>
          </div>
        </div>

        <!-- Warning -->
        <div
          class="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800"
        >
          <div class="flex gap-3">
            <span class="text-amber-600">⚠️</span>
            <div class="text-sm text-amber-800 dark:text-amber-300">
              <p>
                {{
                  t('resend.warning', {
                    count: selectedBackup?.messageCount,
                    chat: selectedTarget?.title,
                  })
                }}
              </p>
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
            {{ t('common.startResending') }}
          </button>
        </div>
      </div>
    </template>

    <!-- Step 5: Sending -->
    <template v-else-if="step === 'sending'">
      <div class="text-center py-12">
        <div
          class="animate-spin w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-5"
        ></div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {{ t('resend.sending') }}
        </h2>

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
          {{ sentCount }} /
          {{ currentProgress?.totalMessages || selectedBackup?.messageCount || 0 }}
          <span class="text-base font-normal text-gray-500">
            {{
              ' ' +
              t('export.messages', {
                count: currentProgress?.totalMessages || selectedBackup?.messageCount || 0,
              })
            }}
          </span>
        </div>

        <div
          class="w-full max-w-xs mx-auto h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-4"
        >
          <div
            class="h-full bg-blue-600 transition-all duration-100"
            :style="{ width: `${progressPercentage}%` }"
          ></div>
        </div>

        <div v-if="currentProgress" class="text-xs text-gray-500 space-y-1">
          <div>
            {{ t('resend.textCount') }}: {{ currentProgress.exportedTextMessages }} •
            {{ t('resend.mediaCount') }}:
            {{ currentProgress.exportedMediaMessages }}
          </div>
          <div v-if="currentProgress.failedMessages > 0" class="text-red-500">
            {{ t('resend.failedCount') }}: {{ currentProgress.failedMessages }}
          </div>
        </div>

        <button
          @click="cancelResend"
          class="mt-6 px-4 py-2 rounded-md font-medium text-sm bg-red-600 text-white hover:bg-red-700 transition-colors duration-100"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </template>

    <!-- Step 6: Complete -->
    <template v-else-if="step === 'complete'">
      <div class="text-center py-12">
        <div class="text-4xl mb-4">✅</div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {{ t('resend.resendComplete') }}
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
          {{ t('resend.successMessage', { count: sentCount, chat: selectedTarget?.title }) }}
        </p>

        <div v-if="currentProgress?.failedMessages" class="text-sm text-amber-600 mb-4">
          {{ t('resend.failedMessage', { count: currentProgress.failedMessages }) }}
        </div>

        <div class="flex gap-3 justify-center">
          <router-link
            to="/"
            class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
          >
            {{ t('resend.backToHome') }}
          </router-link>
          <button
            @click="step = 'select-backup'"
            class="px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            {{ t('resend.resendAnother') }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
