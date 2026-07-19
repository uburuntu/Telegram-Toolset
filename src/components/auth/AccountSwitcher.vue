<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccountsStore, useUiStore } from '@/stores'
import type { SavedAccount } from '@/types'

const { t } = useI18n()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()

const isOpen = ref(false)

function toggleDropdown(): void {
  isOpen.value = !isOpen.value
}

function closeDropdown(): void {
  isOpen.value = false
}

function selectAccount(id: string): void {
  accountsStore.setActiveAccount(id)
  closeDropdown()
}

function addUserAccount(): void {
  closeDropdown()
  uiStore.openModal('LoginModal', { requiredType: 'user' })
}

function addBotAccount(): void {
  closeDropdown()
  uiStore.openModal('LoginModal', { requiredType: 'bot' })
}

function reloginAccount(id: string): void {
  accountsStore.setActiveAccount(id)
  closeDropdown()
  uiStore.openModal('LoginModal', {
    requiredType: 'user',
    replaceAccountId: id,
  })
}

async function removeAccount(id: string): Promise<void> {
  if (confirm(`${t('accounts.removeAccount')}?`)) {
    try {
      await accountsStore.removeAccount(id)
    } catch (error) {
      uiStore.showToast('error', error instanceof Error ? error.message : t('common.error'))
    }
  }
}

function isAccountSelected(accountId: string): boolean {
  return accountId === accountsStore.activeAccountId
}

function isAccountNeedsLogin(account: SavedAccount): boolean {
  return (
    account.type === 'user' && accountsStore.getAccountSessionState(account.id) === 'needs_login'
  )
}

function isAccountCorrupted(account: SavedAccount): boolean {
  return accountsStore.isAccountCorrupted(account.id)
}

const displayName = computed(() => {
  if (!accountsStore.activeAccount) {
    return t('accounts.notLoggedIn')
  }
  return accountsStore.activeAccount.firstName || accountsStore.activeAccount.label
})

const displayIcon = computed(() => {
  if (!accountsStore.activeAccount) {
    return '👤'
  }
  return accountsStore.activeAccount.type === 'bot' ? '🤖' : '👤'
})

const activeAccountNeedsLogin = computed(
  () => accountsStore.activeAccount?.type === 'user' && accountsStore.activeAccountNeedsLogin,
)
</script>

<template>
  <div class="relative">
    <button
      @click="toggleDropdown"
      :title="activeAccountNeedsLogin ? t('accounts.needsLogin') : undefined"
      class="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-100"
    >
      <span>{{ displayIcon }}</span>
      <span
        class="text-sm font-medium text-gray-700 dark:text-gray-300 max-w-[120px] truncate hidden sm:inline"
      >
        {{ displayName }}
      </span>
      <span
        v-if="activeAccountNeedsLogin"
        class="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0"
        aria-hidden="true"
      ></span>
      <svg
        class="w-3.5 h-3.5 text-gray-400 transition-transform duration-100"
        :class="{ 'rotate-180': isOpen }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="isOpen"
        class="absolute right-0 mt-1 w-72 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50"
      >
        <div v-if="accountsStore.accounts.length > 0" class="p-1.5">
          <p class="px-2.5 py-1 text-xs font-medium text-gray-400 uppercase tracking-wide">
            {{ t('common.accounts') }}
          </p>

          <div
            v-for="account in accountsStore.accounts"
            :key="account.id"
            :class="[
              'flex items-center gap-2 rounded-md px-2.5 py-2 transition-colors duration-100',
              isAccountCorrupted(account)
                ? 'bg-red-50 dark:bg-red-950/20'
                : isAccountNeedsLogin(account)
                  ? 'bg-amber-50 dark:bg-amber-950/20'
                  : isAccountSelected(account.id)
                    ? 'bg-blue-50 dark:bg-blue-900/30'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800',
            ]"
          >
            <button
              @click="selectAccount(account.id)"
              class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <span class="text-base flex-shrink-0">
                {{ account.type === 'bot' ? '🤖' : '👤' }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="font-medium text-gray-900 dark:text-white text-sm truncate">
                  {{ account.firstName || account.label }}
                </div>
                <div class="text-xs text-gray-500 truncate">
                  <span v-if="account.username">@{{ account.username }}</span>
                  <span v-else-if="account.phone">{{ account.phone }}</span>
                  <span v-else>{{
                    account.type === 'bot'
                      ? t('accountInfo.botAccount')
                      : t('accountInfo.userAccount')
                  }}</span>
                </div>
              </div>
            </button>

            <div class="flex items-center gap-1.5 pl-2">
              <span
                v-if="isAccountCorrupted(account)"
                :title="t('accounts.secretUnreadableHint')"
                class="px-2 py-1 rounded-full text-[11px] font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
              >
                {{ t('accounts.secretUnreadable') }}
              </span>
              <span
                v-else-if="isAccountNeedsLogin(account)"
                class="px-2 py-1 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
              >
                {{ t('accounts.needsLogin') }}
              </span>
              <span
                v-else-if="isAccountSelected(account.id)"
                class="px-2 py-1 rounded-full text-[11px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
              >
                {{ t('accounts.selected') }}
              </span>
              <button
                v-if="isAccountNeedsLogin(account)"
                @click="reloginAccount(account.id)"
                class="px-2 py-1 rounded-md text-xs font-medium transition-colors duration-100 bg-amber-600 text-white hover:bg-amber-700"
              >
                {{ t('accounts.logInAgain') }}
              </button>
              <button
                @click="removeAccount(account.id)"
                class="p-1 text-gray-400 hover:text-red-500 transition-colors duration-100"
                :title="t('accounts.removeAccount')"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div
          v-if="accountsStore.accounts.length > 0"
          class="border-t border-gray-100 dark:border-gray-800"
        ></div>

        <div class="p-1.5">
          <button
            @click="addUserAccount"
            class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-100"
          >
            <span class="text-base">➕</span>
            <span class="text-sm text-gray-700 dark:text-gray-300">{{
              t('accounts.addUserAccount')
            }}</span>
          </button>
          <button
            @click="addBotAccount"
            class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-100"
          >
            <span class="text-base">🤖</span>
            <span class="text-sm text-gray-700 dark:text-gray-300">{{
              t('accounts.addBotToken')
            }}</span>
          </button>
        </div>
      </div>
    </Transition>

    <div v-if="isOpen" class="fixed inset-0 z-40" @click="closeDropdown"></div>
  </div>
</template>
