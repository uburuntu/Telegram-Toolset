/**
 * Multi-account store supporting both user accounts and bot tokens
 */

import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import { computed, ref } from 'vue'
import type { AccountType, ApiCredentials, AuthFlowState, SavedAccount } from '@/types/account'

const ACCOUNTS_STORAGE_KEY = 'telegram_accounts'
const ACTIVE_ACCOUNT_KEY = 'telegram_active_account'
const API_CREDENTIALS_KEY = 'telegram_api_credentials'

export const useAccountsStore = defineStore('accounts', () => {
  // State
  const accounts = ref<SavedAccount[]>([])
  const activeAccountId = ref<string | null>(null)
  const apiCredentials = ref<ApiCredentials | null>(null)
  const authFlow = ref<AuthFlowState>({
    step: 'idle',
    accountType: 'user',
  })

  // Getters
  const activeAccount = computed(
    () => accounts.value.find((a) => a.id === activeAccountId.value) ?? null,
  )

  const userAccounts = computed(() => accounts.value.filter((a) => a.type === 'user'))

  const botAccounts = computed(() => accounts.value.filter((a) => a.type === 'bot'))

  const hasAnyAccount = computed(() => accounts.value.length > 0)

  const hasUserAccount = computed(() => userAccounts.value.length > 0)

  const hasBotAccount = computed(() => botAccounts.value.length > 0)

  const isActiveAccountUser = computed(() => activeAccount.value?.type === 'user')

  const isActiveAccountBot = computed(() => activeAccount.value?.type === 'bot')

  // Actions
  function loadFromStorage(): void {
    try {
      const storedAccounts = localStorage.getItem(ACCOUNTS_STORAGE_KEY)
      if (storedAccounts) {
        const parsed = JSON.parse(storedAccounts)
        accounts.value = parsed.map((a: SavedAccount & { apiId?: number; apiHash?: string }) => {
          // Migrate: if account has apiId/apiHash from old format, extract them
          if (a.apiId && a.apiHash && !apiCredentials.value) {
            apiCredentials.value = { apiId: a.apiId, apiHash: a.apiHash }
            saveApiCredentials()
          }
          const { apiId: _, apiHash: __, ...rest } = a
          return {
            ...rest,
            createdAt: new Date(a.createdAt),
            lastUsedAt: new Date(a.lastUsedAt),
          }
        })
      }

      const storedActive = localStorage.getItem(ACTIVE_ACCOUNT_KEY)
      if (storedActive && accounts.value.some((a) => a.id === storedActive)) {
        activeAccountId.value = storedActive
      }

      // Load API credentials from dedicated storage
      const storedCreds = localStorage.getItem(API_CREDENTIALS_KEY)
      if (storedCreds) {
        apiCredentials.value = JSON.parse(storedCreds)
      }
    } catch (e) {
      console.error('Failed to load accounts from storage:', e)
    }
  }

  function saveToStorage(): void {
    try {
      localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts.value))
      if (activeAccountId.value) {
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, activeAccountId.value)
      } else {
        localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
      }
    } catch (e) {
      console.error('Failed to save accounts to storage:', e)
    }
  }

  function saveApiCredentials(): void {
    try {
      if (apiCredentials.value) {
        localStorage.setItem(API_CREDENTIALS_KEY, JSON.stringify(apiCredentials.value))
      } else {
        localStorage.removeItem(API_CREDENTIALS_KEY)
      }
    } catch (e) {
      console.error('Failed to save API credentials to storage:', e)
    }
  }

  function setApiCredentials(creds: ApiCredentials): void {
    apiCredentials.value = creds
    saveApiCredentials()
  }

  function addAccount(
    account: Omit<SavedAccount, 'id' | 'createdAt' | 'lastUsedAt'>,
  ): SavedAccount {
    const newAccount: SavedAccount = {
      ...account,
      id: uuidv4(),
      createdAt: new Date(),
      lastUsedAt: new Date(),
    }
    accounts.value.push(newAccount)
    saveToStorage()
    return newAccount
  }

  function updateAccount(id: string, updates: Partial<SavedAccount>): void {
    const index = accounts.value.findIndex((a) => a.id === id)
    if (index !== -1) {
      accounts.value[index] = { ...accounts.value[index], ...updates } as SavedAccount
      saveToStorage()
    }
  }

  function removeAccount(id: string): void {
    accounts.value = accounts.value.filter((a) => a.id !== id)
    if (activeAccountId.value === id) {
      activeAccountId.value = accounts.value[0]?.id ?? null
    }
    saveToStorage()
  }

  function setActiveAccount(id: string | null): void {
    if (id === null || accounts.value.some((a) => a.id === id)) {
      activeAccountId.value = id
      if (id) {
        updateAccount(id, { lastUsedAt: new Date() })
      }
      saveToStorage()
    }
  }

  function getCompatibleAccounts(requiredType: 'user' | 'bot' | 'any'): SavedAccount[] {
    if (requiredType === 'any') {
      return accounts.value
    }
    return accounts.value.filter((a) => a.type === requiredType)
  }

  function findBotByTelegramId(telegramBotId: number): SavedAccount | null {
    return botAccounts.value.find((a) => a.botTelegramId === telegramBotId) ?? null
  }

  function hasCompatibleAccount(requiredType: 'user' | 'bot' | 'any'): boolean {
    return getCompatibleAccounts(requiredType).length > 0
  }

  function isActiveAccountCompatible(requiredType: 'user' | 'bot' | 'any'): boolean {
    if (!activeAccount.value) return false
    if (requiredType === 'any') return true
    return activeAccount.value.type === requiredType
  }

  // Auth flow management
  function startAuthFlow(accountType: AccountType): void {
    authFlow.value = {
      step: accountType === 'user' ? 'phone' : 'bot_token',
      accountType,
    }
  }

  function setAuthFlowApiCredentials(apiId: number, apiHash: string): void {
    authFlow.value.apiId = apiId
    authFlow.value.apiHash = apiHash
  }

  function setAuthFlowPhone(phone: string, phoneCodeHash: string): void {
    authFlow.value.phone = phone
    authFlow.value.phoneCodeHash = phoneCodeHash
    authFlow.value.step = 'code'
  }

  function setAuthFlowNeedsPassword(): void {
    authFlow.value.step = 'password'
  }

  function setAuthFlowError(error: string): void {
    authFlow.value.error = error
    authFlow.value.step = 'error'
  }

  function setAuthFlowComplete(): void {
    authFlow.value.step = 'complete'
  }

  function resetAuthFlow(): void {
    authFlow.value = {
      step: 'idle',
      accountType: 'user',
    }
  }

  return {
    // State
    accounts,
    activeAccountId,
    apiCredentials,
    authFlow,
    // Getters
    activeAccount,
    userAccounts,
    botAccounts,
    hasAnyAccount,
    hasUserAccount,
    hasBotAccount,
    isActiveAccountUser,
    isActiveAccountBot,
    // Actions
    loadFromStorage,
    saveToStorage,
    addAccount,
    updateAccount,
    removeAccount,
    setActiveAccount,
    setApiCredentials,
    getCompatibleAccounts,
    hasCompatibleAccount,
    isActiveAccountCompatible,
    findBotByTelegramId,
    // Auth flow
    startAuthFlow,
    setAuthFlowApiCredentials,
    setAuthFlowPhone,
    setAuthFlowNeedsPassword,
    setAuthFlowError,
    setAuthFlowComplete,
    resetAuthFlow,
  }
})
