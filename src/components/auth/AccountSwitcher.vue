<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccountsStore, useUiStore } from '@/stores'

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
  accountsStore.startAuthFlow('user')
  uiStore.openModal('LoginModal', { requiredType: 'user' })
}

function addBotAccount(): void {
  closeDropdown()
  accountsStore.startAuthFlow('bot')
  uiStore.openModal('LoginModal', { requiredType: 'bot' })
}

function removeAccount(id: string, event: Event): void {
  event.stopPropagation()
  if (confirm(`${t('accounts.removeAccount')}?`)) {
    accountsStore.removeAccount(id)
  }
}

const displayName = computed(() => {
  if (!accountsStore.activeAccount) {
    return t('accounts.notLoggedIn')
  }
  // Use firstName if available (from Telegram API), otherwise fall back to label
  return accountsStore.activeAccount.firstName || accountsStore.activeAccount.label
})

const displayIcon = computed(() => {
  if (!accountsStore.activeAccount) {
    return '👤'
  }
  return accountsStore.activeAccount.type === 'bot' ? '🤖' : '👤'
})
</script>

<template>
  <div class="relative">
    <button
      @click="toggleDropdown"
      class="flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-100"
    >
      <span>{{ displayIcon }}</span>
      <span
        class="text-sm font-medium text-gray-700 dark:text-gray-300 max-w-[100px] truncate hidden sm:inline"
      >
        {{ displayName }}
      </span>
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

    <!-- Dropdown -->
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
        class="absolute right-0 mt-1 w-64 bg-white dark:bg-gray-900 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50"
      >
        <!-- Account List -->
        <div v-if="accountsStore.accounts.length > 0" class="p-1.5">
          <p class="px-2.5 py-1 text-xs font-medium text-gray-400 uppercase tracking-wide">
            {{ t('common.accounts') }}
          </p>

          <button
            v-for="account in accountsStore.accounts"
            :key="account.id"
            @click="selectAccount(account.id)"
            :class="[
              'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left transition-colors duration-100 group',
              account.id === accountsStore.activeAccountId
                ? 'bg-blue-50 dark:bg-blue-900/30'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800',
            ]"
          >
            <span class="text-base flex-shrink-0">
              {{ account.type === 'bot' ? '🤖' : '👤' }}
            </span>
            <div class="flex-1 min-w-0">
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
            <div class="flex items-center gap-1">
              <span
                v-if="account.id === accountsStore.activeAccountId"
                class="text-xs text-blue-600 dark:text-blue-400"
              >
                {{ t('accounts.active') }}
              </span>
              <button
                @click="removeAccount(account.id, $event)"
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
          </button>
        </div>

        <!-- Divider -->
        <div
          v-if="accountsStore.accounts.length > 0"
          class="border-t border-gray-100 dark:border-gray-800"
        ></div>

        <!-- Add Account Options -->
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

    <!-- Click outside to close -->
    <div v-if="isOpen" class="fixed inset-0 z-40" @click="closeDropdown"></div>
  </div>
</template>
