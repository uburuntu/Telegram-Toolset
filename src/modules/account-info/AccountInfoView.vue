<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccountProfilePhotos } from '@/composables'
import { type BotApiUser, getBotInfo } from '@/services/telegram/bot-api'
import type {
  AccountSecurityInfo,
  AccountSessionInfo,
  AccountStats,
  FullUserInfo,
} from '@/services/telegram/client'
import { telegramAccountGateway } from '@/services/telegram/gateway'
import { useAccountsStore, useUiStore } from '@/stores'
import { formatDateWithLocale, formatNumberWithLocale } from '@/utils/locale-format'

const { locale, t } = useI18n()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()
const { loadAccountProfilePhoto, photoUrlFor } = useAccountProfilePhotos()

const isLoading = ref(true)
const error = ref('')
const botApiInfo = ref<BotApiUser | null>(null)
const fullUserInfo = ref<FullUserInfo | null>(null)
const accountStats = ref<AccountStats | null>(null)
const accountSecurityInfo = ref<AccountSecurityInfo | null>(null)
let accountLoadRequestId = 0

const account = computed(() => accountsStore.activeAccount)
const isBot = computed(() => account.value?.type === 'bot')
const isUser = computed(() => account.value?.type === 'user')

async function loadAccountInfo(): Promise<void> {
  const requestId = ++accountLoadRequestId
  const selectedAccount = account.value

  botApiInfo.value = null
  fullUserInfo.value = null
  accountStats.value = null
  accountSecurityInfo.value = null
  error.value = ''
  isLoading.value = true

  if (!selectedAccount) {
    error.value = t('accountInfo.noAccountSelected')
    isLoading.value = false
    return
  }

  try {
    if (selectedAccount.type === 'bot' && selectedAccount.botToken) {
      const info = await getBotInfo(selectedAccount.botToken)
      if (requestId === accountLoadRequestId) {
        botApiInfo.value = info
      }
      return
    }

    if (selectedAccount.type === 'user') {
      const [fullInfo, stats, securityInfo] = await Promise.all([
        telegramAccountGateway.getFullMe(),
        telegramAccountGateway.getAccountStats(),
        telegramAccountGateway.getAccountSecurityInfo(),
      ])

      if (requestId !== accountLoadRequestId) {
        return
      }

      fullUserInfo.value = fullInfo
      accountStats.value = stats
      accountSecurityInfo.value = securityInfo

      if (fullInfo?.hasProfilePhoto) {
        await loadAccountProfilePhoto(selectedAccount.id)
        if (requestId !== accountLoadRequestId) {
          return
        }
      }
    }
  } catch (loadError) {
    if (requestId === accountLoadRequestId) {
      error.value = loadError instanceof Error ? loadError.message : t('common.error')
    }
  } finally {
    if (requestId === accountLoadRequestId) {
      isLoading.value = false
    }
  }
}

watch(
  () => account.value?.id,
  () => {
    void loadAccountInfo()
  },
  { immediate: true },
)

onUnmounted(() => {
  accountLoadRequestId++
})

function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text)
  uiStore.showToast('success', t('common.copied'))
}

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
  return isBot.value && botApiInfo.value
    ? botApiInfo.value.username
    : fullUserInfo.value?.username || account.value?.username
})

const telegramLink = computed(() => {
  return displayUsername.value ? usernameLink(displayUsername.value) : null
})

const displayId = computed(() => {
  if (isBot.value && botApiInfo.value) {
    return String(botApiInfo.value.id)
  }
  return fullUserInfo.value?.id.toString() || account.value?.id || ''
})

const displayPhone = computed(() => fullUserInfo.value?.phone || account.value?.phone)
const isPremiumAccount = computed(
  () => fullUserInfo.value?.isPremium || botApiInfo.value?.is_premium || false,
)
const profilePhotoUrl = computed(() => photoUrlFor(account.value?.id))

const initials = computed(() => {
  const parts = displayName.value.trim().split(/\s+/)
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0] || '')
      .join('')
      .toUpperCase() || '?'
  )
})

function usernameLink(username: string): string {
  return `https://t.me/${username}`
}

function formatAbsoluteDate(date: Date | string): string {
  return formatDateWithLocale(new Date(date), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatAbsoluteDateTime(date: Date | string): string {
  return formatDateWithLocale(new Date(date), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatBirthday(birthday: NonNullable<FullUserInfo['birthday']>): string {
  const date = new Date(Date.UTC(birthday.year ?? 2000, birthday.month - 1, birthday.day))
  return formatDateWithLocale(date, {
    month: 'long',
    day: 'numeric',
    ...(birthday.year ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  })
}

function formatLanguage(languageCode: string): string {
  try {
    const name = new Intl.DisplayNames([locale.value], { type: 'language' }).of(languageCode)
    return name ? `${name} (${languageCode.toUpperCase()})` : languageCode.toUpperCase()
  } catch {
    return languageCode.toUpperCase()
  }
}

function formatDurationDays(days: number): string {
  const averageMonthDays = 365.25 / 12
  const approximateMonths = Math.max(1, Math.round(days / averageMonthDays))
  let value = days
  let unit: Intl.NumberFormatOptions['unit'] = 'day'

  if (days >= 28 && Math.abs(days - approximateMonths * averageMonthDays) <= 4) {
    if (approximateMonths % 12 === 0) {
      value = approximateMonths / 12
      unit = 'year'
    } else {
      value = approximateMonths
      unit = 'month'
    }
  }

  return new Intl.NumberFormat(locale.value, {
    style: 'unit',
    unit,
    unitDisplay: 'long',
  }).format(value)
}

function formatCount(value: number): string {
  return formatNumberWithLocale(value)
}

function sessionDevice(session: AccountSessionInfo): string {
  const system = [session.platform, session.systemVersion].filter(Boolean).join(' ')
  return [session.deviceModel, system].filter(Boolean).join(', ')
}
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-8">
    <header class="mb-6">
      <h1 class="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
        {{ t('accountInfo.title') }}
      </h1>
      <p class="text-sm text-gray-600 dark:text-gray-400">{{ t('accountInfo.subtitle') }}</p>
    </header>

    <div v-if="isLoading" class="py-12 text-center" role="status" aria-live="polite">
      <div
        class="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"
      ></div>
      <p class="text-gray-600 dark:text-gray-400">{{ t('accountInfo.loading') }}</p>
    </div>

    <div v-else-if="error" class="py-12 text-center" role="alert" aria-live="assertive">
      <p class="mb-4 text-sm text-red-600 dark:text-red-400">{{ error }}</p>
      <button
        type="button"
        class="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors duration-100 hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        @click="loadAccountInfo"
      >
        {{ t('common.tryAgain') }}
      </button>
    </div>

    <div v-else-if="account" class="space-y-4">
      <section
        class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        :aria-labelledby="'account-profile-heading'"
      >
        <div class="mb-5 flex items-center gap-4">
          <div class="relative shrink-0">
            <div v-if="profilePhotoUrl" class="h-16 w-16 overflow-hidden rounded-lg">
              <img :src="profilePhotoUrl" :alt="displayName" class="h-full w-full object-cover" />
            </div>
            <div
              v-else
              :class="[
                'flex h-16 w-16 items-center justify-center rounded-lg text-xl font-semibold text-white',
                isBot ? 'bg-purple-600' : 'bg-blue-600',
              ]"
              aria-hidden="true"
            >
              {{ initials }}
            </div>

            <span
              v-if="fullUserInfo?.isVerified"
              class="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white ring-2 ring-white dark:ring-gray-900"
              :title="t('accountInfo.verified')"
              aria-hidden="true"
            >
              ✓
            </span>
          </div>

          <div class="min-w-0 flex-1">
            <h2
              id="account-profile-heading"
              class="break-words text-lg font-semibold text-gray-900 dark:text-white"
            >
              {{ displayName }}
            </h2>
            <p v-if="displayUsername" class="break-all text-sm text-gray-500">
              @{{ displayUsername }}
            </p>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span
                :class="[
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  isBot
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                    : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
                ]"
              >
                {{ isBot ? t('accountInfo.botAccount') : t('accountInfo.userAccount') }}
              </span>
              <span
                v-if="isPremiumAccount"
                class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                :title="t('accountInfo.premiumMember')"
              >
                {{ t('accountInfo.premium') }}
              </span>
            </div>
          </div>
        </div>

        <p
          v-if="fullUserInfo?.bio"
          class="mb-4 whitespace-pre-wrap border-l-2 border-gray-200 pl-3 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300"
        >
          {{ fullUserInfo.bio }}
        </p>

        <dl class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          <div class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4">
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.accountId') }}</dt>
            <dd class="flex min-w-0 items-center gap-2 text-sm text-gray-900 dark:text-white">
              <code class="break-all font-mono">{{ displayId }}</code>
              <button
                type="button"
                class="shrink-0 rounded p-1 text-gray-500 transition-colors duration-100 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                :title="t('common.copy')"
                :aria-label="t('common.copy')"
                @click="copyToClipboard(displayId)"
              >
                <span aria-hidden="true">⧉</span>
              </button>
            </dd>
          </div>

          <div
            v-if="displayUsername"
            class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4"
          >
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.username') }}</dt>
            <dd class="min-w-0 text-sm">
              <a
                :href="telegramLink || undefined"
                target="_blank"
                rel="noopener noreferrer"
                class="break-all text-blue-600 hover:underline dark:text-blue-400"
              >
                @{{ displayUsername }}
              </a>
            </dd>
          </div>

          <div
            v-if="fullUserInfo?.activeUsernames.length"
            class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4"
          >
            <dt class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.alternateUsernames') }}
            </dt>
            <dd class="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-sm">
              <a
                v-for="username in fullUserInfo.activeUsernames"
                :key="username"
                :href="usernameLink(username)"
                target="_blank"
                rel="noopener noreferrer"
                class="break-all text-blue-600 hover:underline dark:text-blue-400"
              >
                @{{ username }}
              </a>
            </dd>
          </div>

          <div
            v-if="isUser && displayPhone"
            class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4"
          >
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.phone') }}</dt>
            <dd class="text-sm text-gray-900 dark:text-white">
              {{ displayPhone.startsWith('+') ? displayPhone : `+${displayPhone}` }}
            </dd>
          </div>

          <div
            v-if="fullUserInfo?.birthday"
            class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4"
          >
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.birthday') }}</dt>
            <dd class="text-sm text-gray-900 dark:text-white">
              {{ formatBirthday(fullUserInfo.birthday) }}
            </dd>
          </div>

          <div
            v-if="fullUserInfo?.languageCode"
            class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4"
          >
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.language') }}</dt>
            <dd class="text-sm text-gray-900 dark:text-white">
              {{ formatLanguage(fullUserInfo.languageCode) }}
            </dd>
          </div>

          <div
            v-if="fullUserInfo?.hasProfilePhoto"
            class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4"
          >
            <dt class="text-sm text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.profileMedia') }}
            </dt>
            <dd class="text-sm text-gray-900 dark:text-white">
              {{
                fullUserInfo.hasProfileVideo
                  ? t('accountInfo.photoAndVideo')
                  : t('accountInfo.photo')
              }}
            </dd>
          </div>

          <div
            v-if="fullUserInfo?.dcId"
            class="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4"
          >
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.dataCenter') }}</dt>
            <dd class="text-sm text-gray-900 dark:text-white">DC{{ fullUserInfo.dcId }}</dd>
          </div>
        </dl>
      </section>

      <section
        v-if="isUser && accountStats"
        class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        aria-labelledby="account-statistics-heading"
      >
        <h3 id="account-statistics-heading" class="mb-4 text-base font-medium text-gray-900 dark:text-white">
          {{ t('accountInfo.statistics') }}
        </h3>
        <dl class="grid grid-cols-3 gap-3">
          <div class="min-w-0 border-l-2 border-blue-500 pl-3">
            <dd class="text-xl font-semibold text-gray-900 dark:text-white">
              {{ formatCount(accountStats.dialogsCount) }}
            </dd>
            <dt class="break-words text-xs text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.chats') }}
            </dt>
          </div>
          <div class="min-w-0 border-l-2 border-green-500 pl-3">
            <dd class="text-xl font-semibold text-gray-900 dark:text-white">
              {{ formatCount(accountStats.contactsCount) }}
            </dd>
            <dt class="break-words text-xs text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.contacts') }}
            </dt>
          </div>
          <div class="min-w-0 border-l-2 border-red-500 pl-3">
            <dd class="text-xl font-semibold text-gray-900 dark:text-white">
              {{ formatCount(accountStats.blockedCount) }}
            </dd>
            <dt class="break-words text-xs text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.blocked') }}
            </dt>
          </div>
        </dl>
      </section>

      <section
        v-if="isUser && accountSecurityInfo"
        data-testid="account-security"
        class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        aria-labelledby="account-security-heading"
      >
        <h3 id="account-security-heading" class="mb-4 text-base font-medium text-gray-900 dark:text-white">
          {{ t('accountInfo.securityAndSessions') }}
        </h3>

        <dl class="grid gap-x-6 sm:grid-cols-2">
          <div class="border-t border-gray-100 py-3 dark:border-gray-800">
            <dt class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.twoStepVerification') }}
            </dt>
            <dd
              :class="accountSecurityInfo.twoStepVerificationEnabled ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'"
              class="mt-1 text-sm font-medium"
            >
              {{
                accountSecurityInfo.twoStepVerificationEnabled
                  ? t('accountInfo.enabled')
                  : t('accountInfo.disabled')
              }}
            </dd>
          </div>
          <div class="border-t border-gray-100 py-3 dark:border-gray-800">
            <dt class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.recoveryEmail') }}
            </dt>
            <dd class="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {{
                accountSecurityInfo.recoveryEmailConfigured
                  ? t('accountInfo.configured')
                  : t('accountInfo.notConfigured')
              }}
            </dd>
          </div>
          <div class="border-t border-gray-100 py-3 dark:border-gray-800">
            <dt class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.authorizedSessions') }}
            </dt>
            <dd class="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {{
                t('accountInfo.sessionsSummary', {
                  total: formatCount(accountSecurityInfo.authorizedSessionsCount),
                  other: formatCount(accountSecurityInfo.otherSessionsCount),
                })
              }}
            </dd>
          </div>
          <div class="border-t border-gray-100 py-3 dark:border-gray-800">
            <dt class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.unconfirmedSessions') }}
            </dt>
            <dd
              :class="accountSecurityInfo.unconfirmedSessionsCount > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-white'"
              class="mt-1 text-sm font-medium"
            >
              {{ formatCount(accountSecurityInfo.unconfirmedSessionsCount) }}
            </dd>
          </div>
          <div class="border-t border-gray-100 py-3 dark:border-gray-800">
            <dt class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.inactiveSessionExpiry') }}
            </dt>
            <dd class="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {{
                t('accountInfo.afterDuration', {
                  duration: formatDurationDays(accountSecurityInfo.authorizationTtlDays),
                })
              }}
            </dd>
          </div>
          <div class="border-t border-gray-100 py-3 dark:border-gray-800">
            <dt class="text-xs text-gray-500 dark:text-gray-400">
              {{ t('accountInfo.accountDeletion') }}
            </dt>
            <dd class="mt-1 text-sm font-medium text-gray-900 dark:text-white">
              {{
                t('accountInfo.afterDuration', {
                  duration: formatDurationDays(accountSecurityInfo.accountTtlDays),
                })
              }}
            </dd>
          </div>
        </dl>

        <div
          v-if="accountSecurityInfo.currentSession"
          class="mt-2 border-t border-gray-200 pt-4 dark:border-gray-700"
        >
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <h4 class="text-sm font-medium text-gray-900 dark:text-white">
              {{ t('accountInfo.currentSession') }}
            </h4>
            <span
              class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              {{
                accountSecurityInfo.currentSession.officialApp
                  ? t('accountInfo.officialApp')
                  : t('accountInfo.thirdPartyApp')
              }}
            </span>
          </div>
          <dl class="grid gap-x-6 sm:grid-cols-2">
            <div class="py-2">
              <dt class="text-xs text-gray-500 dark:text-gray-400">{{ t('accountInfo.application') }}</dt>
              <dd class="mt-1 break-words text-sm text-gray-900 dark:text-white">
                {{ accountSecurityInfo.currentSession.appName }}
                <span v-if="accountSecurityInfo.currentSession.appVersion">
                  {{ accountSecurityInfo.currentSession.appVersion }}
                </span>
              </dd>
            </div>
            <div class="py-2">
              <dt class="text-xs text-gray-500 dark:text-gray-400">{{ t('accountInfo.device') }}</dt>
              <dd class="mt-1 break-words text-sm text-gray-900 dark:text-white">
                {{ sessionDevice(accountSecurityInfo.currentSession) }}
              </dd>
            </div>
            <div v-if="accountSecurityInfo.currentSession.location" class="py-2">
              <dt class="text-xs text-gray-500 dark:text-gray-400">{{ t('accountInfo.location') }}</dt>
              <dd class="mt-1 break-words text-sm text-gray-900 dark:text-white">
                {{ accountSecurityInfo.currentSession.location }}
              </dd>
            </div>
            <div class="py-2">
              <dt class="text-xs text-gray-500 dark:text-gray-400">{{ t('accountInfo.authorizedOn') }}</dt>
              <dd class="mt-1 text-sm text-gray-900 dark:text-white">
                {{ formatAbsoluteDateTime(accountSecurityInfo.currentSession.createdAt) }}
              </dd>
            </div>
            <div class="py-2">
              <dt class="text-xs text-gray-500 dark:text-gray-400">{{ t('accountInfo.lastActive') }}</dt>
              <dd class="mt-1 text-sm text-gray-900 dark:text-white">
                {{ formatAbsoluteDateTime(accountSecurityInfo.currentSession.lastActiveAt) }}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section
        v-if="isBot && botApiInfo"
        class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        aria-labelledby="bot-capabilities-heading"
      >
        <h3 id="bot-capabilities-heading" class="mb-2 text-base font-medium text-gray-900 dark:text-white">
          {{ t('accountInfo.capabilities') }}
        </h3>
        <dl class="divide-y divide-gray-100 dark:divide-gray-800">
          <div class="grid gap-1 py-3 sm:grid-cols-2 sm:gap-4">
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.canJoinGroups') }}</dt>
            <dd class="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
              <span
                :class="botApiInfo.can_join_groups ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'"
                class="h-2 w-2 shrink-0 rounded-full"
                aria-hidden="true"
              ></span>
              {{ botApiInfo.can_join_groups ? t('accountInfo.yes') : t('accountInfo.no') }}
            </dd>
          </div>
          <div class="grid gap-1 py-3 sm:grid-cols-2 sm:gap-4">
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.canReadAllMessages') }}</dt>
            <dd class="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
              <span
                :class="botApiInfo.can_read_all_group_messages ? 'bg-green-500' : 'bg-amber-500'"
                class="h-2 w-2 shrink-0 rounded-full"
                aria-hidden="true"
              ></span>
              {{
                botApiInfo.can_read_all_group_messages
                  ? t('accountInfo.yes')
                  : t('accountInfo.privacyMode')
              }}
            </dd>
          </div>
          <div class="grid gap-1 py-3 sm:grid-cols-2 sm:gap-4">
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.supportsInline') }}</dt>
            <dd class="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
              <span
                :class="botApiInfo.supports_inline_queries ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'"
                class="h-2 w-2 shrink-0 rounded-full"
                aria-hidden="true"
              ></span>
              {{ botApiInfo.supports_inline_queries ? t('accountInfo.enabled') : t('accountInfo.disabled') }}
            </dd>
          </div>
          <div class="grid gap-1 py-3 sm:grid-cols-2 sm:gap-4">
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.attachmentMenu') }}</dt>
            <dd class="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
              <span
                :class="botApiInfo.added_to_attachment_menu ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'"
                class="h-2 w-2 shrink-0 rounded-full"
                aria-hidden="true"
              ></span>
              {{ botApiInfo.added_to_attachment_menu ? t('accountInfo.enabled') : t('accountInfo.disabled') }}
            </dd>
          </div>
          <div class="grid gap-1 py-3 sm:grid-cols-2 sm:gap-4">
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.businessConnections') }}</dt>
            <dd class="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
              <span
                :class="botApiInfo.can_connect_to_business ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'"
                class="h-2 w-2 shrink-0 rounded-full"
                aria-hidden="true"
              ></span>
              {{ botApiInfo.can_connect_to_business ? t('accountInfo.enabled') : t('accountInfo.disabled') }}
            </dd>
          </div>
          <div class="grid gap-1 py-3 sm:grid-cols-2 sm:gap-4">
            <dt class="text-sm text-gray-500 dark:text-gray-400">{{ t('accountInfo.hasWebApp') }}</dt>
            <dd class="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
              <span
                :class="botApiInfo.has_main_web_app ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'"
                class="h-2 w-2 shrink-0 rounded-full"
                aria-hidden="true"
              ></span>
              {{ botApiInfo.has_main_web_app ? t('accountInfo.enabled') : t('accountInfo.disabled') }}
            </dd>
          </div>
        </dl>
      </section>

      <section
        v-if="fullUserInfo?.isRestricted"
        class="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20"
        role="alert"
      >
        <h3 class="font-medium text-red-800 dark:text-red-300">
          {{ t('accountInfo.accountRestricted') }}
        </h3>
        <p v-if="fullUserInfo.restrictionReason" class="mt-1 text-sm text-red-700 dark:text-red-400">
          {{ fullUserInfo.restrictionReason }}
        </p>
      </section>

      <section
        v-if="telegramLink"
        class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        aria-labelledby="quick-links-heading"
      >
        <h3 id="quick-links-heading" class="mb-3 text-base font-medium text-gray-900 dark:text-white">
          {{ t('accountInfo.quickLinks') }}
        </h3>
        <div class="grid gap-2 sm:grid-cols-2">
          <a
            :href="telegramLink"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors duration-100 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {{ t('accountInfo.openInTelegram') }}
          </a>
          <a
            v-if="isBot"
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors duration-100 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {{ t('accountInfo.editWithBotFather') }}
          </a>
          <a
            v-if="isUser"
            href="https://my.telegram.org/"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors duration-100 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {{ t('accountInfo.telegramSettings') }}
          </a>
          <a
            v-if="isUser"
            href="https://web.telegram.org/"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded border border-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors duration-100 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {{ t('accountInfo.webTelegram') }}
          </a>
        </div>
      </section>

      <section
        class="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900"
        aria-labelledby="account-management-heading"
      >
        <h3 id="account-management-heading" class="mb-3 text-base font-medium text-gray-900 dark:text-white">
          {{ t('accountInfo.accountManagement') }}
        </h3>
        <dl class="grid gap-x-6 sm:grid-cols-2">
          <div class="border-t border-gray-100 py-3 dark:border-gray-800">
            <dt class="text-xs text-gray-500 dark:text-gray-400">{{ t('accountInfo.added') }}</dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{ formatAbsoluteDate(account.createdAt) }}
            </dd>
          </div>
          <div class="border-t border-gray-100 py-3 dark:border-gray-800">
            <dt class="text-xs text-gray-500 dark:text-gray-400">{{ t('accountInfo.lastUsed') }}</dt>
            <dd class="mt-1 text-sm text-gray-900 dark:text-white">
              {{ formatAbsoluteDate(account.lastUsedAt) }}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </main>
</template>
