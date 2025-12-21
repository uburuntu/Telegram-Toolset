<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAccountsStore, useUiStore } from '@/stores'
import { getBotInfo, type BotApiUser } from '@/services/telegram/bot-api'

const accountsStore = useAccountsStore()
const uiStore = useUiStore()

const isLoading = ref(true)
const error = ref('')

// Bot-specific data (loaded from API if not cached)
const botApiInfo = ref<BotApiUser | null>(null)

const account = computed(() => accountsStore.activeAccount)
const isBot = computed(() => account.value?.type === 'bot')
const isUser = computed(() => account.value?.type === 'user')

onMounted(async () => {
  if (!account.value) {
    error.value = 'No account selected'
    isLoading.value = false
    return
  }

  try {
    if (isBot.value && account.value.botToken) {
      // Fetch fresh bot info from API
      botApiInfo.value = await getBotInfo(account.value.botToken)
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load account info'
  } finally {
    isLoading.value = false
  }
})

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text)
  uiStore.showToast('success', 'Copied to clipboard')
}

// Computed display values
const displayName = computed(() => {
  if (isBot.value && botApiInfo.value) {
    return botApiInfo.value.first_name
  }
  return account.value?.firstName || account.value?.label || 'Unknown'
})

const displayUsername = computed(() => {
  if (isBot.value && botApiInfo.value) {
    return botApiInfo.value.username
  }
  return account.value?.username
})

const telegramLink = computed(() => {
  if (displayUsername.value) {
    return `https://t.me/${displayUsername.value}`
  }
  return null
})
</script>

<template>
  <div class="max-w-2xl mx-auto py-8 px-4">
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Account Info</h1>
      <p class="text-gray-600 dark:text-gray-400">View your account profile and settings</p>
    </header>

    <!-- Loading -->
    <div v-if="isLoading" class="text-center py-12">
      <div
        class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
      ></div>
      <p class="text-gray-600 dark:text-gray-400">Loading account info...</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="text-center py-12">
      <div class="text-3xl mb-3">❌</div>
      <p class="text-red-600">{{ error }}</p>
    </div>

    <!-- Account Info -->
    <div v-else-if="account" class="space-y-4">
      <!-- Profile Card -->
      <div
        class="bg-white dark:bg-gray-900 rounded-lg p-5 border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <div class="flex items-center gap-4 mb-5">
          <div
            :class="[
              'w-14 h-14 rounded-lg flex items-center justify-center text-2xl',
              isBot ? 'bg-purple-600' : 'bg-blue-600',
            ]"
          >
            {{ isBot ? '🤖' : '👤' }}
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {{ displayName }}
            </h2>
            <p v-if="displayUsername" class="text-sm text-gray-500">@{{ displayUsername }}</p>
            <span
              :class="[
                'inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded-full',
                isBot
                  ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                  : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
              ]"
            >
              {{ isBot ? 'Bot' : 'User Account' }}
            </span>
          </div>
        </div>

        <div class="space-y-2">
          <!-- Account ID -->
          <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded">
            <span class="text-sm text-gray-600 dark:text-gray-400">Account ID</span>
            <div class="flex items-center gap-2">
              <code class="text-sm font-mono text-gray-900 dark:text-white">
                {{ isBot && botApiInfo ? botApiInfo.id : account.id.slice(0, 8) }}
              </code>
              <button
                @click="copyToClipboard(isBot && botApiInfo ? String(botApiInfo.id) : account.id)"
                class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-100"
                title="Copy"
              >
                📋
              </button>
            </div>
          </div>

          <!-- Username (if available) -->
          <div
            v-if="displayUsername"
            class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded"
          >
            <span class="text-sm text-gray-600 dark:text-gray-400">Username</span>
            <a
              v-if="telegramLink"
              :href="telegramLink"
              target="_blank"
              class="text-sm text-blue-600 hover:underline"
            >
              @{{ displayUsername }}
            </a>
            <span v-else class="text-sm text-gray-900 dark:text-white">@{{ displayUsername }}</span>
          </div>

          <!-- Phone (for users) -->
          <div
            v-if="isUser && account.phone"
            class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded"
          >
            <span class="text-sm text-gray-600 dark:text-gray-400">Phone</span>
            <span class="text-sm text-gray-900 dark:text-white">{{ account.phone }}</span>
          </div>
        </div>
      </div>

      <!-- Bot Capabilities (for bots only) -->
      <div
        v-if="isBot && botApiInfo"
        class="bg-white dark:bg-gray-900 rounded-lg p-5 border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <h3 class="font-medium text-gray-900 dark:text-white mb-3">Bot Capabilities</h3>

        <div class="space-y-2">
          <div class="flex items-center justify-between p-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">Can join groups</span>
            <span
              :class="botApiInfo.can_join_groups ? 'text-green-600' : 'text-red-600'"
              class="text-sm"
            >
              {{ botApiInfo.can_join_groups ? '✅ Yes' : '❌ No' }}
            </span>
          </div>

          <div class="flex items-center justify-between p-2">
            <span class="text-sm text-gray-600 dark:text-gray-400"
              >Can read all group messages</span
            >
            <span
              :class="botApiInfo.can_read_all_group_messages ? 'text-green-600' : 'text-amber-600'"
              class="text-sm"
            >
              {{ botApiInfo.can_read_all_group_messages ? '✅ Yes' : '⚠️ Privacy mode' }}
            </span>
          </div>

          <div class="flex items-center justify-between p-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">Inline queries</span>
            <span
              :class="botApiInfo.supports_inline_queries ? 'text-green-600' : 'text-gray-500'"
              class="text-sm"
            >
              {{ botApiInfo.supports_inline_queries ? '✅ Enabled' : '— Disabled' }}
            </span>
          </div>

          <div v-if="botApiInfo.has_main_web_app" class="flex items-center justify-between p-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">Web App</span>
            <span class="text-green-600 text-sm">✅ Has Web App</span>
          </div>
        </div>
      </div>

      <!-- Quick Links -->
      <div
        v-if="telegramLink"
        class="bg-white dark:bg-gray-900 rounded-lg p-5 border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <h3 class="font-medium text-gray-900 dark:text-white mb-3">Quick Links</h3>

        <div class="grid gap-2 sm:grid-cols-2">
          <a
            :href="telegramLink"
            target="_blank"
            class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            <span class="text-lg">💬</span>
            <span class="text-sm text-gray-700 dark:text-gray-300">Open in Telegram</span>
          </a>

          <a
            v-if="isBot"
            href="https://t.me/BotFather"
            target="_blank"
            class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            <span class="text-lg">⚙️</span>
            <span class="text-sm text-gray-700 dark:text-gray-300">Edit with BotFather</span>
          </a>
        </div>
      </div>

      <!-- Account Management -->
      <div
        class="bg-white dark:bg-gray-900 rounded-lg p-5 border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <h3 class="font-medium text-gray-900 dark:text-white mb-3">Account Management</h3>

        <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <p><strong>Added:</strong> {{ new Date(account.createdAt).toLocaleDateString() }}</p>
          <p><strong>Last used:</strong> {{ new Date(account.lastUsedAt).toLocaleDateString() }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
