<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountsStore, useUiStore } from '@/stores'
import { modules } from '@/modules'
import type { ToolModule } from '@/types'

const router = useRouter()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()

function getAccountTypeLabel(type: 'user' | 'bot' | 'any'): string {
  switch (type) {
    case 'user':
      return 'User Account'
    case 'bot':
      return 'Bot Token'
    case 'any':
      return 'Any Account'
  }
}

function getAccountTypeBadgeClass(type: 'user' | 'bot' | 'any'): string {
  switch (type) {
    case 'user':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
    case 'bot':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
    case 'any':
      return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
  }
}

function handleModuleClick(module: ToolModule): void {
  // Check if we have a compatible account
  if (!accountsStore.isActiveAccountCompatible(module.accountType)) {
    // Need to login or switch account
    if (accountsStore.hasCompatibleAccount(module.accountType)) {
      // We have a compatible account, just need to switch
      const compatibleAccounts = accountsStore.getCompatibleAccounts(module.accountType)
      if (compatibleAccounts[0]) {
        accountsStore.setActiveAccount(compatibleAccounts[0].id)
      }
      router.push(module.route.path)
    } else {
      // Need to add a new account
      const requiredType = module.accountType === 'any' ? 'user' : module.accountType
      accountsStore.startAuthFlow(requiredType)
      uiStore.openModal('LoginModal', { requiredType, targetRoute: module.route.path })
    }
  } else {
    // Already have compatible active account
    router.push(module.route.path)
  }
}

const sortedModules = computed(() => {
  // Show compatible modules first
  return [...modules].sort((a, b) => {
    const aCompatible = accountsStore.isActiveAccountCompatible(a.accountType)
    const bCompatible = accountsStore.isActiveAccountCompatible(b.accountType)
    if (aCompatible && !bCompatible) return -1
    if (!aCompatible && bCompatible) return 1
    return 0
  })
})
</script>

<template>
  <div class="max-w-5xl mx-auto py-10 px-4">
    <!-- Hero Section -->
    <header class="text-center mb-10">
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-3">Telegram Power Toolset</h1>
      <p class="text-base text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
        Advanced features for Telegram that aren't available in official apps. 100% on-device, open
        source, and privacy-focused.
      </p>
    </header>

    <!-- Account Status Banner -->
    <div
      v-if="!accountsStore.hasAnyAccount"
      class="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg"
    >
      <div class="flex items-center gap-3">
        <span class="text-xl">👋</span>
        <div class="flex-1">
          <p class="font-medium text-sm text-gray-900 dark:text-white">Welcome!</p>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            Click on any tool below to get started. You'll be prompted to connect your Telegram
            account.
          </p>
        </div>
      </div>
    </div>

    <!-- Active Account Info -->
    <div
      v-else-if="accountsStore.activeAccount"
      class="mb-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg"
    >
      <div class="flex items-center gap-3">
        <div
          :class="[
            'w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-medium',
            accountsStore.activeAccount.type === 'bot' ? 'bg-purple-600' : 'bg-green-600',
          ]"
        >
          {{
            accountsStore.activeAccount.type === 'bot'
              ? '🤖'
              : (accountsStore.activeAccount.firstName || accountsStore.activeAccount.label)[0]
          }}
        </div>
        <div class="flex-1">
          <p class="font-medium text-sm text-gray-900 dark:text-white">
            {{ accountsStore.activeAccount.firstName || accountsStore.activeAccount.label }}
            <span v-if="accountsStore.activeAccount.username" class="text-gray-500">
              @{{ accountsStore.activeAccount.username }}
            </span>
          </p>
          <p class="text-xs text-gray-600 dark:text-gray-400">
            {{ accountsStore.activeAccount.type === 'bot' ? 'Bot' : 'User Account' }}
          </p>
        </div>
        <span class="text-xs text-gray-500">
          {{ accountsStore.accounts.length }} account{{
            accountsStore.accounts.length !== 1 ? 's' : ''
          }}
        </span>
      </div>
    </div>

    <!-- Module Grid -->
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="module in sortedModules"
        :key="module.id"
        @click="handleModuleClick(module)"
        class="group text-left p-5 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow hover:border-gray-300 dark:hover:border-gray-700 transition-all duration-100"
      >
        <div class="flex items-start gap-3">
          <div
            class="flex-shrink-0 w-11 h-11 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg text-2xl"
          >
            <span v-if="module.icon === 'download'">📥</span>
            <span v-else-if="module.icon === 'send'">📤</span>
            <span v-else-if="module.icon === 'bot'">🤖</span>
            <span v-else>🔧</span>
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="font-medium text-gray-900 dark:text-white mb-1">
              {{ module.name }}
            </h2>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-2.5 line-clamp-2">
              {{ module.description }}
            </p>
            <span
              :class="[
                'inline-block px-2 py-0.5 text-xs font-medium rounded-full',
                getAccountTypeBadgeClass(module.accountType),
              ]"
            >
              {{ getAccountTypeLabel(module.accountType) }}
            </span>
          </div>
        </div>

        <!-- Compatibility indicator -->
        <div
          v-if="
            accountsStore.hasAnyAccount &&
            !accountsStore.isActiveAccountCompatible(module.accountType)
          "
          class="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800"
        >
          <p class="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <span>⚠️</span>
            <span v-if="accountsStore.hasCompatibleAccount(module.accountType)">
              Switch to a {{ module.accountType }} account to use
            </span>
            <span v-else>
              Add a {{ module.accountType === 'user' ? 'user account' : 'bot token' }} to use
            </span>
          </p>
        </div>
      </button>
    </div>

    <!-- Features Section -->
    <div class="mt-12 grid gap-6 md:grid-cols-3">
      <div class="text-center">
        <div class="text-3xl mb-2">🔒</div>
        <h3 class="font-medium text-gray-900 dark:text-white mb-1">100% Private</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          Everything runs in your browser. No servers, no tracking.
        </p>
      </div>
      <div class="text-center">
        <div class="text-3xl mb-2">💾</div>
        <h3 class="font-medium text-gray-900 dark:text-white mb-1">Local Storage</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          Your data stays on your device. Export as ZIP anytime.
        </p>
      </div>
      <div class="text-center">
        <div class="text-3xl mb-2">📖</div>
        <h3 class="font-medium text-gray-900 dark:text-white mb-1">Open Source</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          Fully transparent. Review or contribute to the code.
        </p>
      </div>
    </div>
  </div>
</template>
