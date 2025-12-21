<script setup lang="ts">
import { onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAccountsStore, useUiStore } from '@/stores'
import { telegramService } from '@/services/telegram/client'
import AccountSwitcher from '@/components/auth/AccountSwitcher.vue'
import LoginModal from '@/components/auth/LoginModal.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import PrivacyFooter from '@/components/layout/PrivacyFooter.vue'

const { t } = useI18n()

const route = useRoute()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()

// Check if login modal is open
const showLoginModal = computed(() => uiStore.currentModal?.component === 'LoginModal')

const loginModalProps = computed(
  () => uiStore.currentModal?.props as { requiredType?: string; targetRoute?: string } | undefined
)

onMounted(() => {
  // Load accounts from storage
  accountsStore.loadFromStorage()

  // Load privacy notice state
  uiStore.loadPrivacyNoticeState()

  // Detect mobile
  const updateMobile = () => {
    uiStore.setMobile(window.innerWidth < 1024)
  }
  updateMobile()
  window.addEventListener('resize', updateMobile)

  // Check if redirected here needing auth
  if (route.query.needsAuth === 'true') {
    const requiredType = (route.query.accountType as 'user' | 'bot' | 'any') || 'any'
    accountsStore.startAuthFlow(requiredType === 'any' ? 'user' : requiredType)
    uiStore.openModal('LoginModal', {
      requiredType,
      targetRoute: route.query.redirect as string,
    })
  }
})

// Watch for auth query params
watch(
  () => route.query,
  (query) => {
    if (query.needsAuth === 'true' && !showLoginModal.value) {
      const requiredType = (query.accountType as 'user' | 'bot' | 'any') || 'any'
      accountsStore.startAuthFlow(requiredType === 'any' ? 'user' : requiredType)
      uiStore.openModal('LoginModal', {
        requiredType,
        targetRoute: query.redirect as string,
      })
    }
  }
)

// Keep Telegram client session in sync with the active user account (multi-account support).
// Skip if an auth flow is in progress (LoginModal manages its own client lifecycle during login).
watch(
  () => accountsStore.activeAccount,
  async (account) => {
    // Don't interfere while a login flow is active.
    if (accountsStore.authFlow.step !== 'idle' && accountsStore.authFlow.step !== 'complete') {
      return
    }

    if (!account || account.type !== 'user') return
    if (!account.apiId || !account.apiHash) return

    // Check for useUserAccountSession method (may be missing in E2E mocks)
    if (!('useUserAccountSession' in telegramService)) return
    // eslint-disable-next-line no-unused-vars
    type SessionFn = (o: {
      sessionString?: string
      apiId: number
      apiHash: string
    }) => Promise<boolean>
    const useSession = telegramService.useUserAccountSession as SessionFn | undefined
    if (typeof useSession !== 'function') return

    try {
      await useSession({
        sessionString: account.sessionString,
        apiId: account.apiId,
        apiHash: account.apiHash,
      })
    } catch {
      // Don't spam on startup; module UIs will show their own errors/reconnect UI if needed.
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
    <!-- Header -->
    <header class="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <router-link to="/" class="flex items-center gap-2">
          <span class="text-xl">📱</span>
          <span class="font-semibold text-gray-900 dark:text-white hidden sm:inline">
            Telegram Toolset
          </span>
        </router-link>

        <div class="flex items-center gap-2">
          <LanguageSwitcher />
          <AccountSwitcher />
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-1">
      <router-view />
    </main>

    <!-- Footer -->
    <PrivacyFooter />

    <!-- Login Modal -->
    <LoginModal
      v-if="showLoginModal"
      :required-type="loginModalProps?.requiredType as any"
      :target-route="loginModalProps?.targetRoute"
      @close="uiStore.closeModal()"
    />

    <!-- Toast notifications -->
    <div class="fixed top-16 right-4 z-50 space-y-2">
      <TransitionGroup name="toast">
        <div
          v-for="toast in uiStore.toasts"
          :key="toast.id"
          :class="[
            'px-4 py-2.5 rounded-md shadow-lg max-w-sm text-sm font-medium',
            toast.type === 'success' && 'bg-green-600 text-white',
            toast.type === 'error' && 'bg-red-600 text-white',
            toast.type === 'warning' && 'bg-amber-500 text-white',
            toast.type === 'info' && 'bg-blue-600 text-white',
          ]"
        >
          {{ toast.message }}
        </div>
      </TransitionGroup>
    </div>

    <!-- Privacy notice modal (first visit) -->
    <div
      v-if="accountsStore.hasAnyAccount && !uiStore.hasSeenPrivacyNotice"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    >
      <div class="bg-white dark:bg-gray-900 rounded-xl shadow-lg max-w-md w-full p-6">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          🔒 {{ t('privacy.modalTitle') }}
        </h2>
        <div class="space-y-3 text-gray-600 dark:text-gray-400 text-sm mb-5">
          <p>{{ t('privacy.modalText') }}</p>
          <ul class="space-y-2">
            <li class="flex items-start gap-2">
              <span class="text-green-500">✓</span>
              <span>{{ t('privacy.noServer') }}</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="text-green-500">✓</span>
              <span>{{ t('privacy.noTracking') }}</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="text-green-500">✓</span>
              <span>{{ t('privacy.noCookies') }}</span>
            </li>
            <li class="flex items-start gap-2">
              <span class="text-green-500">✓</span>
              <span>{{ t('privacy.openSourceNote') }}</span>
            </li>
          </ul>
          <p class="text-xs">
            {{ t('privacy.sessionNote') }}
          </p>
        </div>
        <div class="flex gap-3">
          <a
            href="https://github.com/uburuntu/Telegram-Deleted-Messages-Manager"
            target="_blank"
            rel="noopener noreferrer"
            class="flex-1 px-4 py-2 rounded-md font-medium text-sm text-center transition-colors duration-100 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            {{ t('privacy.viewOnGitHub') }}
          </a>
          <button
            @click="uiStore.acknowledgePrivacyNotice()"
            class="flex-1 px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-blue-600 text-white hover:bg-blue-700"
          >
            {{ t('privacy.understand') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
@import 'tailwindcss';

/* Base styles */
body {
  background-color: #f9fafb;
  color: #111827;
}

@media (prefers-color-scheme: dark) {
  body {
    background-color: #030712;
    color: #ffffff;
  }
}

/* Toast animations - fast 100ms */
.toast-enter-active {
  animation: toast-in 100ms ease-out;
}

.toast-leave-active {
  animation: toast-out 100ms ease-out;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateX(16px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes toast-out {
  from {
    opacity: 1;
    transform: translateX(0);
  }
  to {
    opacity: 0;
    transform: translateX(16px);
  }
}
</style>
