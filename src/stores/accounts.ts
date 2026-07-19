/**
 * Multi-account store supporting both user accounts and bot tokens.
 * Non-sensitive account metadata stays in localStorage for fast boot.
 * Sensitive material is encrypted into IndexedDB via WebCrypto.
 */

import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import { computed, ref } from 'vue'
import {
  deleteSecureAccountSecret,
  loadSecureAccountSecret,
  loadSecureApiCredentials,
  type PersistedAccountSecret,
  saveSecureAccountSecret,
  saveSecureApiCredentials,
} from '@/services/storage/secure-account-vault'
import type { ApiCredentials, SavedAccount } from '@/types/account'
import type { TelegramPrincipal } from '@/types/principal'
import { principalsMatch } from '@/utils/principal'

const ACCOUNTS_STORAGE_KEY = 'telegram_accounts'
const ACTIVE_ACCOUNT_KEY = 'telegram_active_account'
const API_CREDENTIALS_KEY = 'telegram_api_credentials'
const ACCOUNT_EPOCH_KEY_PREFIX = 'telegram_account_epoch:'

type StoredAccountRecord = Omit<
  SavedAccount,
  'createdAt' | 'lastUsedAt' | 'sessionString' | 'botToken'
> & {
  createdAt: string
  lastUsedAt: string
  sessionString?: string
  botToken?: string
  apiId?: number
  apiHash?: string
}

export type AccountSessionState = 'unknown' | 'ready' | 'needs_login'

function parseStoredAccounts(): StoredAccountRecord[] {
  const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY)
  if (!raw) {
    return []
  }

  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? (parsed as StoredAccountRecord[]) : []
}

function parseStoredApiCredentials(): ApiCredentials | null {
  const raw = localStorage.getItem(API_CREDENTIALS_KEY)
  if (!raw) {
    return null
  }

  return JSON.parse(raw) as ApiCredentials
}

function getEmbeddedApiCredentials(accounts: StoredAccountRecord[]): ApiCredentials | null {
  for (const account of accounts) {
    if (typeof account.apiId === 'number' && typeof account.apiHash === 'string') {
      return {
        apiId: account.apiId,
        apiHash: account.apiHash,
      }
    }
  }

  return null
}

function hasLegacyPlaintextData(
  accounts: StoredAccountRecord[],
  hasStoredCredentialKey: boolean,
): boolean {
  if (hasStoredCredentialKey) {
    return true
  }

  return accounts.some(
    (account) =>
      typeof account.sessionString === 'string' ||
      typeof account.botToken === 'string' ||
      typeof account.apiId === 'number' ||
      typeof account.apiHash === 'string',
  )
}

function getPersistedAccountSecret(account: SavedAccount): PersistedAccountSecret | null {
  if (account.type === 'user') {
    return account.sessionString ? { sessionString: account.sessionString } : null
  }

  return account.botToken ? { botToken: account.botToken } : null
}

function hydrateAccount(
  stored: StoredAccountRecord,
  secret: PersistedAccountSecret | null,
): SavedAccount {
  const {
    sessionString: legacySessionString,
    botToken: legacyBotToken,
    apiId: _,
    apiHash: __,
    ...rest
  } = stored

  return {
    ...rest,
    createdAt: new Date(stored.createdAt),
    lastUsedAt: new Date(stored.lastUsedAt),
    sessionString:
      stored.type === 'user'
        ? (secret?.sessionString ?? legacySessionString ?? '')
        : (legacySessionString ?? `bot_session_${stored.id}`),
    botToken: stored.type === 'bot' ? (secret?.botToken ?? legacyBotToken) : undefined,
  }
}

function serializeAccountMetadata(account: SavedAccount): StoredAccountRecord {
  const {
    sessionString: _sessionString,
    botToken: _botToken,
    createdAt,
    lastUsedAt,
    ...rest
  } = account

  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    lastUsedAt: lastUsedAt.toISOString(),
  }
}

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<SavedAccount[]>([])
  const activeAccountId = ref<string | null>(null)
  const apiCredentials = ref<ApiCredentials | null>(null)
  const sessionStateByAccountId = ref<Record<string, AccountSessionState>>({})
  const storageLoaded = ref(false)

  // Monotonic per-account epoch. Removing an account advances its epoch before any archival runs, so
  // long-running jobs that captured the prior epoch fail their commit fence instead of writing an
  // owned record for an account that is being torn down (ARCHITECTURE.md §3, criteria 4 & 5).
  //
  // It is persisted per account in localStorage, which is synchronously consistent across same-origin
  // tabs: reading it at commit time therefore fences a late write whose account was removed in
  // another tab, without waiting for a `storage`/BroadcastChannel notification. The tombstone key is
  // intentionally never deleted on removal — the advanced value is what keeps fencing late writes for
  // that (never-reused) account id. Broader cross-tab invalidation of cached account/ownership state
  // is separate Stage C (§6) work.
  function getAccountEpoch(id: string): number {
    const raw = localStorage.getItem(`${ACCOUNT_EPOCH_KEY_PREFIX}${id}`)
    if (raw === null) {
      return 0
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  }

  function setAccountEpoch(id: string, epoch: number): void {
    localStorage.setItem(`${ACCOUNT_EPOCH_KEY_PREFIX}${id}`, String(epoch))
  }

  function bumpAccountEpoch(id: string): void {
    setAccountEpoch(id, getAccountEpoch(id) + 1)
  }

  function restoreAccountEpoch(id: string, epoch: number): void {
    setAccountEpoch(id, epoch)
  }

  let loadPromise: Promise<void> | null = null

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

  const activeAccountSessionState = computed(() => {
    if (!activeAccount.value || activeAccount.value.type !== 'user') {
      return 'ready' as const
    }

    return sessionStateByAccountId.value[activeAccount.value.id] ?? 'unknown'
  })

  const activeAccountNeedsLogin = computed(() => activeAccountSessionState.value === 'needs_login')

  function syncSessionStateMap(): void {
    const nextSessionState: Record<string, AccountSessionState> = {}

    for (const account of accounts.value) {
      if (account.type === 'user') {
        nextSessionState[account.id] = sessionStateByAccountId.value[account.id] ?? 'unknown'
      }
    }

    sessionStateByAccountId.value = nextSessionState
  }

  function persistMetadataToLocalStorage(): void {
    if (accounts.value.length > 0) {
      localStorage.setItem(
        ACCOUNTS_STORAGE_KEY,
        JSON.stringify(accounts.value.map(serializeAccountMetadata)),
      )
    } else {
      localStorage.removeItem(ACCOUNTS_STORAGE_KEY)
    }

    if (activeAccountId.value) {
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, activeAccountId.value)
    } else {
      localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
    }

    // Remove the legacy plaintext credentials key once the secure path is active.
    localStorage.removeItem(API_CREDENTIALS_KEY)
  }

  async function persistAccountSecret(account: SavedAccount): Promise<void> {
    await saveSecureAccountSecret(account.id, getPersistedAccountSecret(account))
  }

  async function migrateLegacyPlaintextData(): Promise<void> {
    await Promise.all(accounts.value.map((account) => persistAccountSecret(account)))
    await saveSecureApiCredentials(apiCredentials.value)
    persistMetadataToLocalStorage()
  }

  async function loadFromStorage(): Promise<void> {
    if (storageLoaded.value) {
      return
    }

    if (loadPromise) {
      return loadPromise
    }

    loadPromise = (async () => {
      try {
        const storedAccounts = parseStoredAccounts()
        const legacyCredentials = parseStoredApiCredentials()
        const secureCredentials = await loadSecureApiCredentials()
        const nextApiCredentials =
          secureCredentials ?? legacyCredentials ?? getEmbeddedApiCredentials(storedAccounts)

        // Load API credentials before publishing accounts so reactive consumers never
        // observe a user account without the shared app credentials.
        apiCredentials.value = nextApiCredentials

        const secrets = await Promise.all(
          storedAccounts.map(
            async (account) => [account.id, await loadSecureAccountSecret(account.id)] as const,
          ),
        )
        const secretByAccountId = new Map<string, PersistedAccountSecret | null>(secrets)

        accounts.value = storedAccounts.map((account) =>
          hydrateAccount(account, secretByAccountId.get(account.id) ?? null),
        )
        syncSessionStateMap()

        const storedActive = localStorage.getItem(ACTIVE_ACCOUNT_KEY)
        activeAccountId.value =
          storedActive && accounts.value.some((account) => account.id === storedActive)
            ? storedActive
            : null

        if (
          hasLegacyPlaintextData(storedAccounts, legacyCredentials !== null) ||
          (nextApiCredentials !== null && secureCredentials === null)
        ) {
          await migrateLegacyPlaintextData()
        }
      } catch (error) {
        console.error('Failed to load accounts from storage:', error)
      } finally {
        storageLoaded.value = true
        loadPromise = null
      }
    })()

    return loadPromise
  }

  async function setApiCredentials(credentials: ApiCredentials): Promise<void> {
    const previousCredentials = apiCredentials.value
    apiCredentials.value = credentials

    try {
      await saveSecureApiCredentials(credentials)
      persistMetadataToLocalStorage()
    } catch (error) {
      apiCredentials.value = previousCredentials
      throw error
    }
  }

  async function addAccount(
    account: Omit<SavedAccount, 'id' | 'createdAt' | 'lastUsedAt'>,
  ): Promise<SavedAccount> {
    const newAccount: SavedAccount = {
      ...account,
      id: uuidv4(),
      createdAt: new Date(),
      lastUsedAt: new Date(),
    }

    accounts.value.push(newAccount)
    if (newAccount.type === 'user') {
      sessionStateByAccountId.value[newAccount.id] = 'ready'
    }

    try {
      await persistAccountSecret(newAccount)
      persistMetadataToLocalStorage()
      return newAccount
    } catch (error) {
      accounts.value = accounts.value.filter(
        (existingAccount) => existingAccount.id !== newAccount.id,
      )
      delete sessionStateByAccountId.value[newAccount.id]
      throw error
    }
  }

  async function updateAccount(id: string, updates: Partial<SavedAccount>): Promise<void> {
    const index = accounts.value.findIndex((account) => account.id === id)
    if (index === -1) {
      return
    }

    const previousAccount = accounts.value[index]!
    const nextAccount = { ...previousAccount, ...updates } as SavedAccount
    accounts.value[index] = nextAccount

    try {
      await persistAccountSecret(nextAccount)
      persistMetadataToLocalStorage()
    } catch (error) {
      accounts.value[index] = previousAccount
      throw error
    }
  }

  async function removeAccount(id: string): Promise<void> {
    const removedAccount = accounts.value.find((account) => account.id === id)
    if (!removedAccount) {
      return
    }

    // Quiesce the account before archiving: advancing the epoch fences any in-flight job that
    // captured the prior epoch, so a late owned-record write cannot slip in after archival has
    // already scanned the store (ARCHITECTURE.md §3, criterion 4). Rolled back if removal aborts.
    const previousEpoch = getAccountEpoch(id)
    bumpAccountEpoch(id)

    try {
      if (removedAccount.type === 'user') {
        const [{ backupManager }, { chatHistoryService }] = await Promise.all([
          import('@/services/storage/backup-manager'),
          import('@/services/llm-export/chat-history-service'),
        ])

        await Promise.all([
          backupManager.archiveBackupsForRemovedAccount(removedAccount),
          chatHistoryService.archiveChatExportsForRemovedAccount(removedAccount),
        ])
      }
    } catch (error) {
      restoreAccountEpoch(id, previousEpoch)
      console.error('Failed to archive account-owned data before removing account:', error)
      throw error
    }

    const previousAccounts = [...accounts.value]
    const previousActiveAccountId = activeAccountId.value
    const previousSessionState = { ...sessionStateByAccountId.value }

    accounts.value = accounts.value.filter((account) => account.id !== id)
    delete sessionStateByAccountId.value[id]

    if (activeAccountId.value === id) {
      activeAccountId.value = accounts.value[0]?.id ?? null
    }

    try {
      await deleteSecureAccountSecret(id)
      persistMetadataToLocalStorage()
    } catch (error) {
      accounts.value = previousAccounts
      activeAccountId.value = previousActiveAccountId
      sessionStateByAccountId.value = previousSessionState
      restoreAccountEpoch(id, previousEpoch)
      throw error
    }
  }

  function setActiveAccount(id: string | null): void {
    if (id !== null && !accounts.value.some((account) => account.id === id)) {
      return
    }

    activeAccountId.value = id

    if (id) {
      const account = accounts.value.find((entry) => entry.id === id)
      if (account) {
        account.lastUsedAt = new Date()
      }
    }

    try {
      persistMetadataToLocalStorage()
    } catch (error) {
      console.error('Failed to persist active account selection:', error)
    }
  }

  function getCompatibleAccounts(requiredType: 'user' | 'bot' | 'any'): SavedAccount[] {
    if (requiredType === 'any') {
      return accounts.value
    }

    return accounts.value.filter((account) => account.type === requiredType)
  }

  function findBotByTelegramId(telegramBotId: number): SavedAccount | null {
    return botAccounts.value.find((account) => account.botTelegramId === telegramBotId) ?? null
  }

  function findAccountByPrincipal(principal: TelegramPrincipal): SavedAccount | null {
    return accounts.value.find((account) => principalsMatch(account.principal, principal)) ?? null
  }

  function findUserAccountByPrincipal(principal: TelegramPrincipal): SavedAccount | null {
    if (principal.kind !== 'user') {
      return null
    }

    return (
      userAccounts.value.find((account) => principalsMatch(account.principal, principal)) ?? null
    )
  }

  function getAccountSessionState(accountId: string | null | undefined): AccountSessionState {
    if (!accountId) {
      return 'unknown'
    }

    return sessionStateByAccountId.value[accountId] ?? 'unknown'
  }

  function markAccountSessionReady(accountId: string): void {
    sessionStateByAccountId.value[accountId] = 'ready'
  }

  function markAccountNeedsLogin(accountId: string): void {
    sessionStateByAccountId.value[accountId] = 'needs_login'
  }

  function clearAccountSessionState(accountId: string): void {
    delete sessionStateByAccountId.value[accountId]
  }

  function hasCompatibleAccount(requiredType: 'user' | 'bot' | 'any'): boolean {
    return getCompatibleAccounts(requiredType).length > 0
  }

  function isActiveAccountCompatible(requiredType: 'user' | 'bot' | 'any'): boolean {
    if (!activeAccount.value) {
      return false
    }

    if (requiredType === 'any') {
      return true
    }

    return activeAccount.value.type === requiredType
  }

  return {
    accounts,
    activeAccountId,
    apiCredentials,
    sessionStateByAccountId,
    storageLoaded,
    activeAccount,
    userAccounts,
    botAccounts,
    hasAnyAccount,
    hasUserAccount,
    hasBotAccount,
    isActiveAccountUser,
    isActiveAccountBot,
    activeAccountSessionState,
    activeAccountNeedsLogin,
    loadFromStorage,
    addAccount,
    updateAccount,
    removeAccount,
    setActiveAccount,
    setApiCredentials,
    getCompatibleAccounts,
    hasCompatibleAccount,
    isActiveAccountCompatible,
    findBotByTelegramId,
    findAccountByPrincipal,
    findUserAccountByPrincipal,
    getAccountSessionState,
    markAccountSessionReady,
    markAccountNeedsLogin,
    clearAccountSessionState,
    getAccountEpoch,
  }
})
