<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAccountsStore, useUiStore } from '@/stores'
import { modules, contributeCard } from '@/modules'
import type { ToolModule } from '@/types'

const { t } = useI18n()
const router = useRouter()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()

function getAccountTypeLabel(type: 'user' | 'bot' | 'any'): string {
  switch (type) {
    case 'user':
      return t('accounts.userAccount')
    case 'bot':
      return t('accounts.botToken')
    case 'any':
      return t('accounts.anyAccount')
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

function getModuleName(moduleId: string): string {
  const keyMap: Record<string, string> = {
    'account-info': 'modules.accountInfo.name',
    'export-deleted': 'modules.exportDeleted.name',
    resend: 'modules.resend.name',
  }
  return t(keyMap[moduleId] || moduleId)
}

function getModuleDescription(moduleId: string): string {
  const keyMap: Record<string, string> = {
    'account-info': 'modules.accountInfo.description',
    'export-deleted': 'modules.exportDeleted.description',
    resend: 'modules.resend.description',
  }
  return t(keyMap[moduleId] || moduleId)
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
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-3">
        {{ t('landing.title') }}
      </h1>
      <p class="text-base text-gray-600 dark:text-gray-400 max-w-xl mx-auto">
        {{ t('landing.subtitle') }}
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
          <p class="font-medium text-sm text-gray-900 dark:text-white">
            {{ t('landing.welcome') }}
          </p>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('landing.welcomeText') }}
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
            {{
              accountsStore.activeAccount.type === 'bot'
                ? t('accounts.botToken')
                : t('accounts.userAccount')
            }}
          </p>
        </div>
        <span class="text-xs text-gray-500">
          {{ accountsStore.accounts.length }}
          {{ accountsStore.accounts.length === 1 ? t('common.account') : t('common.accounts') }}
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
              {{ getModuleName(module.id) }}
            </h2>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-2.5 line-clamp-2">
              {{ getModuleDescription(module.id) }}
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
              {{ t('landing.switchAccountHint', { type: module.accountType }) }}
            </span>
            <span v-else>
              {{
                t('landing.addAccountHint', {
                  type:
                    module.accountType === 'user'
                      ? t('landing.userAccountType')
                      : t('landing.botTokenType'),
                })
              }}
            </span>
          </p>
        </div>
      </button>

      <!-- Contribute Card -->
      <a
        :href="contributeCard.url"
        target="_blank"
        rel="noopener noreferrer"
        class="group text-left p-5 bg-white dark:bg-gray-900 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-600 transition-all duration-100"
      >
        <div class="flex items-start gap-3">
          <div
            class="flex-shrink-0 w-11 h-11 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg text-gray-400 dark:text-gray-500 group-hover:text-blue-500 transition-colors duration-100"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <div class="flex-1 min-w-0">
            <h2
              class="font-medium text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 mb-1 transition-colors duration-100"
            >
              {{ t('landing.contributeCard.name') }}
            </h2>
            <p class="text-sm text-gray-500 dark:text-gray-500 mb-2.5">
              {{ t('landing.contributeCard.description') }}
            </p>
            <span
              class="inline-block px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500"
            >
              {{ t('common.openSource') }}
            </span>
          </div>
        </div>
      </a>
    </div>

    <!-- Features Section -->
    <div class="mt-12 grid gap-6 md:grid-cols-3">
      <div class="text-center">
        <div class="text-3xl mb-2">🔒</div>
        <h3 class="font-medium text-gray-900 dark:text-white mb-1">
          {{ t('landing.features.private.title') }}
        </h3>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('landing.features.private.text') }}
        </p>
      </div>
      <div class="text-center">
        <div class="text-3xl mb-2">💾</div>
        <h3 class="font-medium text-gray-900 dark:text-white mb-1">
          {{ t('landing.features.localStorage.title') }}
        </h3>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('landing.features.localStorage.text') }}
        </p>
      </div>
      <div class="text-center">
        <div class="text-3xl mb-2">📖</div>
        <h3 class="font-medium text-gray-900 dark:text-white mb-1">
          {{ t('landing.features.openSource.title') }}
        </h3>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('landing.features.openSource.text') }}
        </p>
      </div>
    </div>
  </div>
</template>
