<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import AccountSwitcher from '@/components/auth/AccountSwitcher.vue'
import LoginModal from '@/components/auth/LoginModal.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import JobSurface from '@/components/layout/JobSurface.vue'
import PrivacyFooter from '@/components/layout/PrivacyFooter.vue'
import { useActiveUserSessionSync } from '@/composables'
import { useAccountsStore, useUiStore } from '@/stores'

const { t } = useI18n()

const route = useRoute()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()

const updateMobile = () => {
  uiStore.setMobile(window.innerWidth < 1024)
}

// Check if login modal is open
const showLoginModal = computed(() => uiStore.currentModal?.component === 'LoginModal')
const showSessionRecoveryBanner = computed(
  () =>
    !showLoginModal.value &&
    accountsStore.activeAccount?.type === 'user' &&
    accountsStore.activeAccountNeedsLogin,
)

const loginModalProps = computed(
  () =>
    uiStore.currentModal?.props as
      | { requiredType?: 'user' | 'bot' | 'any'; targetRoute?: string; replaceAccountId?: string }
      | undefined,
)

const sessionRecoveryLabel = computed(
  () => accountsStore.activeAccount?.firstName || accountsStore.activeAccount?.label || '',
)

function openReloginModal(): void {
  const activeAccount = accountsStore.activeAccount
  if (!activeAccount || activeAccount.type !== 'user') {
    return
  }

  uiStore.openModal('LoginModal', {
    requiredType: 'user',
    replaceAccountId: activeAccount.id,
  })
}

onMounted(() => {
  // Load accounts from storage
  if (!accountsStore.storageLoaded) {
    void accountsStore.loadFromStorage()
  }

  // Detect mobile
  updateMobile()
  window.addEventListener('resize', updateMobile)

  // Check if redirected here needing auth
  if (route.query.needsAuth === 'true') {
    const requiredType = (route.query.accountType as 'user' | 'bot' | 'any') || 'any'
    uiStore.openModal('LoginModal', {
      requiredType,
      targetRoute: route.query.redirect as string,
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', updateMobile)
})

// Watch for auth query params
watch(
  () => route.query,
  (query) => {
    if (query.needsAuth === 'true' && !showLoginModal.value) {
      const requiredType = (query.accountType as 'user' | 'bot' | 'any') || 'any'
      uiStore.openModal('LoginModal', {
        requiredType,
        targetRoute: query.redirect as string,
      })
    }
  },
)

useActiveUserSessionSync(showLoginModal)
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

    <!-- Persistent long-running job surface (survives route changes) -->
    <JobSurface />

    <!-- Main Content -->
    <div
      v-if="showSessionRecoveryBanner"
      class="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
    >
      <div
        class="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
      >
        <div class="min-w-0">
          <p class="text-sm font-medium text-amber-900 dark:text-amber-100">
            {{ t('accounts.sessionExpiredTitle', { name: sessionRecoveryLabel }) }}
          </p>
          <p class="text-sm text-amber-800 dark:text-amber-200">
            {{ t('accounts.sessionExpiredDescription') }}
          </p>
        </div>
        <button
          @click="openReloginModal"
          class="px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-amber-600 text-white hover:bg-amber-700 self-start lg:self-auto"
        >
          {{ t('accounts.logInAgain') }}
        </button>
      </div>
    </div>

    <main class="flex-1">
      <router-view />
    </main>

    <!-- Footer -->
    <PrivacyFooter />

    <!-- Login Modal -->
    <LoginModal
      v-if="showLoginModal"
      :required-type="loginModalProps?.requiredType"
      :target-route="loginModalProps?.targetRoute"
      :replace-account-id="loginModalProps?.replaceAccountId"
      @close="uiStore.closeModal()"
    />

    <!-- Toast notifications -->
    <div
      class="fixed top-16 right-4 z-50 space-y-2"
      aria-live="polite"
      aria-atomic="true"
    >
      <TransitionGroup name="toast">
        <div
          v-for="toast in uiStore.toasts"
          :key="toast.id"
          :role="toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'"
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
