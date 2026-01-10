<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccountsStore, useUiStore } from '@/stores'
import { getBotInfo, type BotApiUser } from '@/services/telegram/bot-api'
import { telegramService, type FullUserInfo, type AccountStats } from '@/services/telegram/client'

const { t } = useI18n()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()

const isLoading = ref(true)
const error = ref('')

// Bot-specific data (loaded from API if not cached)
const botApiInfo = ref<BotApiUser | null>(null)

// User-specific extended data
const fullUserInfo = ref<FullUserInfo | null>(null)
const accountStats = ref<AccountStats | null>(null)
const profilePhotoUrl = ref<string | null>(null)

const account = computed(() => accountsStore.activeAccount)
const isBot = computed(() => account.value?.type === 'bot')
const isUser = computed(() => account.value?.type === 'user')

onMounted(async () => {
  if (!account.value) {
    error.value = t('accountInfo.noAccountSelected')
    isLoading.value = false
    return
  }

  try {
    if (isBot.value && account.value.botToken) {
      // Fetch fresh bot info from API
      botApiInfo.value = await getBotInfo(account.value.botToken)
    } else if (isUser.value) {
      // Fetch extended user info
      const [fullInfo, stats, photoBlob] = await Promise.all([
        telegramService.getFullMe(),
        telegramService.getAccountStats(),
        telegramService.downloadMyProfilePhoto(),
      ])

      fullUserInfo.value = fullInfo
      accountStats.value = stats

      if (photoBlob) {
        profilePhotoUrl.value = URL.createObjectURL(photoBlob)
      }
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('common.error')
  } finally {
    isLoading.value = false
  }
})

onUnmounted(() => {
  if (profilePhotoUrl.value) {
    URL.revokeObjectURL(profilePhotoUrl.value)
  }
})

function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text)
  uiStore.showToast('success', t('common.copied'))
}

// Computed display values
const displayName = computed(() => {
  if (isBot.value && botApiInfo.value) {
    return botApiInfo.value.first_name
  }
  if (fullUserInfo.value) {
    const parts = [fullUserInfo.value.firstName, fullUserInfo.value.lastName].filter(Boolean)
    return parts.join(' ') || account.value?.firstName || account.value?.label || 'Unknown'
  }
  return account.value?.firstName || account.value?.label || 'Unknown'
})

const displayUsername = computed(() => {
  if (isBot.value && botApiInfo.value) {
    return botApiInfo.value.username
  }
  return fullUserInfo.value?.username || account.value?.username
})

const telegramLink = computed(() => {
  if (displayUsername.value) {
    return `https://t.me/${displayUsername.value}`
  }
  return null
})

const displayId = computed(() => {
  if (isBot.value && botApiInfo.value) {
    return String(botApiInfo.value.id)
  }
  if (fullUserInfo.value) {
    return fullUserInfo.value.id.toString()
  }
  return account.value?.id || ''
})

const displayPhone = computed(() => {
  return fullUserInfo.value?.phone || account.value?.phone
})

// Get initials for avatar fallback
const initials = computed(() => {
  const name = displayName.value
  if (!name) return '?'
  const parts = name.split(' ')
  if (parts.length >= 2) {
    return (parts[0]![0] || '') + (parts[1]![0] || '')
  }
  return name[0] || '?'
})
</script>

<template>
  <div class="max-w-2xl mx-auto py-8 px-4">
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {{ t('accountInfo.title') }}
      </h1>
      <p class="text-gray-600 dark:text-gray-400">{{ t('accountInfo.subtitle') }}</p>
    </header>

    <!-- Loading -->
    <div v-if="isLoading" class="text-center py-12">
      <div
        class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
      ></div>
      <p class="text-gray-600 dark:text-gray-400">{{ t('accountInfo.loading') }}</p>
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
          <!-- Profile Photo -->
          <div class="relative">
            <div
              v-if="profilePhotoUrl"
              class="w-16 h-16 rounded-xl overflow-hidden ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-gray-900"
            >
              <img :src="profilePhotoUrl" :alt="displayName" class="w-full h-full object-cover" />
            </div>
            <div
              v-else
              :class="[
                'w-16 h-16 rounded-xl flex items-center justify-center text-xl font-semibold text-white',
                isBot ? 'bg-purple-600' : 'bg-gradient-to-br from-blue-500 to-blue-700',
              ]"
            >
              {{ isBot ? '🤖' : initials }}
            </div>

            <!-- Premium badge -->
            <div
              v-if="fullUserInfo?.isPremium"
              class="absolute -bottom-1 -right-1 w-6 h-6 bg-gradient-to-br from-amber-400 to-amber-600 rounded-full flex items-center justify-center text-xs shadow-lg"
              :title="t('accountInfo.premiumMember')"
            >
              ⭐
            </div>

            <!-- Verified badge -->
            <div
              v-if="fullUserInfo?.isVerified"
              class="absolute -top-1 -right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-xs"
              :title="t('accountInfo.verified')"
            >
              ✓
            </div>
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white truncate">
                {{ displayName }}
              </h2>
            </div>
            <p v-if="displayUsername" class="text-sm text-gray-500">@{{ displayUsername }}</p>
            <div class="flex flex-wrap gap-1.5 mt-1.5">
              <span
                :class="[
                  'inline-block px-2 py-0.5 text-xs font-medium rounded-full',
                  isBot
                    ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
                ]"
              >
                {{ isBot ? t('accountInfo.botAccount') : t('accountInfo.userAccount') }}
              </span>
              <span
                v-if="fullUserInfo?.isPremium"
                class="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400"
              >
                ⭐ {{ t('accountInfo.premium') }}
              </span>
            </div>
          </div>
        </div>

        <!-- Bio -->
        <div v-if="fullUserInfo?.bio" class="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p class="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {{ fullUserInfo.bio }}
          </p>
        </div>

        <div class="space-y-2">
          <!-- Account ID -->
          <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded">
            <span class="text-sm text-gray-600 dark:text-gray-400">{{
              t('accountInfo.accountId')
            }}</span>
            <div class="flex items-center gap-2">
              <code class="text-sm font-mono text-gray-900 dark:text-white">
                {{ displayId }}
              </code>
              <button
                @click="copyToClipboard(displayId)"
                class="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-100"
                :title="t('common.copy')"
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
            <span class="text-sm text-gray-600 dark:text-gray-400">{{
              t('accountInfo.username')
            }}</span>
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
            v-if="isUser && displayPhone"
            class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded"
          >
            <span class="text-sm text-gray-600 dark:text-gray-400">{{
              t('accountInfo.phone')
            }}</span>
            <span class="text-sm text-gray-900 dark:text-white">{{ displayPhone?.startsWith('+') ? displayPhone : `+${displayPhone}` }}</span>
          </div>

          <!-- DC ID -->
          <div
            v-if="fullUserInfo?.dcId"
            class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded"
          >
            <span class="text-sm text-gray-600 dark:text-gray-400">{{
              t('accountInfo.dataCenter')
            }}</span>
            <span class="text-sm text-gray-900 dark:text-white">DC{{ fullUserInfo.dcId }}</span>
          </div>
        </div>
      </div>

      <!-- Account Statistics (for users) -->
      <div
        v-if="isUser && accountStats"
        class="bg-white dark:bg-gray-900 rounded-lg p-5 border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <h3 class="font-medium text-gray-900 dark:text-white mb-4">
          {{ t('accountInfo.statistics') }}
        </h3>

        <div class="grid grid-cols-3 gap-4">
          <div class="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div class="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {{ accountStats.dialogsCount }}
            </div>
            <div class="text-xs text-gray-500 mt-1">{{ t('accountInfo.chats') }}</div>
          </div>
          <div class="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div class="text-2xl font-bold text-green-600 dark:text-green-400">
              {{ accountStats.contactsCount }}
            </div>
            <div class="text-xs text-gray-500 mt-1">{{ t('accountInfo.contacts') }}</div>
          </div>
          <div class="text-center p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div class="text-2xl font-bold text-red-600 dark:text-red-400">
              {{ accountStats.blockedCount }}
            </div>
            <div class="text-xs text-gray-500 mt-1">{{ t('accountInfo.blocked') }}</div>
          </div>
        </div>
      </div>

      <!-- Bot Capabilities (for bots only) -->
      <div
        v-if="isBot && botApiInfo"
        class="bg-white dark:bg-gray-900 rounded-lg p-5 border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <h3 class="font-medium text-gray-900 dark:text-white mb-3">
          {{ t('accountInfo.capabilities') }}
        </h3>

        <div class="space-y-2">
          <div class="flex items-center justify-between p-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">{{
              t('accountInfo.canJoinGroups')
            }}</span>
            <span
              :class="botApiInfo.can_join_groups ? 'text-green-600' : 'text-red-600'"
              class="text-sm"
            >
              {{
                botApiInfo.can_join_groups
                  ? '✅ ' + t('accountInfo.yes')
                  : '❌ ' + t('accountInfo.no')
              }}
            </span>
          </div>

          <div class="flex items-center justify-between p-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">{{
              t('accountInfo.canReadAllMessages')
            }}</span>
            <span
              :class="botApiInfo.can_read_all_group_messages ? 'text-green-600' : 'text-amber-600'"
              class="text-sm"
            >
              {{
                botApiInfo.can_read_all_group_messages
                  ? '✅ ' + t('accountInfo.yes')
                  : '⚠️ ' + t('accountInfo.privacyMode')
              }}
            </span>
          </div>

          <div class="flex items-center justify-between p-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">{{
              t('accountInfo.supportsInline')
            }}</span>
            <span
              :class="botApiInfo.supports_inline_queries ? 'text-green-600' : 'text-gray-500'"
              class="text-sm"
            >
              {{
                botApiInfo.supports_inline_queries
                  ? '✅ ' + t('accountInfo.enabled')
                  : '— ' + t('accountInfo.disabled')
              }}
            </span>
          </div>

          <div v-if="botApiInfo.has_main_web_app" class="flex items-center justify-between p-2">
            <span class="text-sm text-gray-600 dark:text-gray-400">{{
              t('accountInfo.hasWebApp')
            }}</span>
            <span class="text-green-600 text-sm">✅ {{ t('accountInfo.yes') }}</span>
          </div>
        </div>
      </div>

      <!-- Restriction Warning -->
      <div
        v-if="fullUserInfo?.isRestricted"
        class="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800"
      >
        <div class="flex items-start gap-3">
          <span class="text-lg">⚠️</span>
          <div>
            <h4 class="font-medium text-red-800 dark:text-red-300">
              {{ t('accountInfo.accountRestricted') }}
            </h4>
            <p
              v-if="fullUserInfo.restrictionReason"
              class="text-sm text-red-700 dark:text-red-400 mt-1"
            >
              {{ fullUserInfo.restrictionReason }}
            </p>
          </div>
        </div>
      </div>

      <!-- Quick Links -->
      <div
        v-if="telegramLink"
        class="bg-white dark:bg-gray-900 rounded-lg p-5 border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <h3 class="font-medium text-gray-900 dark:text-white mb-3">
          {{ t('accountInfo.quickLinks') }}
        </h3>

        <div class="grid gap-2 sm:grid-cols-2">
          <a
            :href="telegramLink"
            target="_blank"
            class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            <span class="text-lg">💬</span>
            <span class="text-sm text-gray-700 dark:text-gray-300">{{
              t('accountInfo.openInTelegram')
            }}</span>
          </a>

          <a
            v-if="isBot"
            href="https://t.me/BotFather"
            target="_blank"
            class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            <span class="text-lg">⚙️</span>
            <span class="text-sm text-gray-700 dark:text-gray-300">{{
              t('accountInfo.editWithBotFather')
            }}</span>
          </a>

          <a
            v-if="isUser"
            href="https://my.telegram.org/"
            target="_blank"
            class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            <span class="text-lg">🔑</span>
            <span class="text-sm text-gray-700 dark:text-gray-300">{{
              t('accountInfo.telegramSettings')
            }}</span>
          </a>

          <a
            v-if="isUser"
            href="https://web.telegram.org/"
            target="_blank"
            class="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            <span class="text-lg">🌐</span>
            <span class="text-sm text-gray-700 dark:text-gray-300">{{
              t('accountInfo.webTelegram')
            }}</span>
          </a>
        </div>
      </div>

      <!-- Account Management -->
      <div
        class="bg-white dark:bg-gray-900 rounded-lg p-5 border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <h3 class="font-medium text-gray-900 dark:text-white mb-3">
          {{ t('accountInfo.accountManagement') }}
        </h3>

        <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <p>
            <strong>{{ t('accountInfo.added') }}:</strong>
            {{ new Date(account.createdAt).toLocaleDateString() }}
          </p>
          <p>
            <strong>{{ t('accountInfo.lastUsed') }}:</strong>
            {{ new Date(account.lastUsedAt).toLocaleDateString() }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
