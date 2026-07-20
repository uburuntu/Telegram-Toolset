/**
 * Multi-account store supporting both user accounts and bot tokens.
 * Non-sensitive account metadata stays in localStorage for fast boot.
 * Sensitive material is encrypted into IndexedDB via WebCrypto.
 */

import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import { computed, ref } from 'vue'
import {
  type AccountJournalEntryInput,
  beginAccountJournal,
  completeAccountJournal,
  readPendingAccountJournal,
} from '@/services/storage/account-journal'
import { createInvalidationChannel } from '@/services/storage/cross-tab'
import type { AccountJournalRecord } from '@/services/storage/indexed-db'
import {
  deleteSecureAccountSecret,
  hasSecureAccountSecret,
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

/**
 * Reconciliation writes localStorage directly (before the store's reactive refs are populated), so
 * these helpers edit only the journaled account and preserve every other entry. That keeps a stale
 * journal snapshot from clobbering a change another tab committed during the crashed tab's dead
 * window.
 */
function writeStoredAccounts(accounts: StoredAccountRecord[]): void {
  if (accounts.length > 0) {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts))
  } else {
    localStorage.removeItem(ACCOUNTS_STORAGE_KEY)
  }
}

function removeStoredAccountMetadata(accountId: string): void {
  const remaining = parseStoredAccounts().filter((account) => account.id !== accountId)
  writeStoredAccounts(remaining)

  if (localStorage.getItem(ACTIVE_ACCOUNT_KEY) === accountId) {
    const nextActive = remaining[0]?.id ?? null
    if (nextActive) {
      localStorage.setItem(ACTIVE_ACCOUNT_KEY, nextActive)
    } else {
      localStorage.removeItem(ACTIVE_ACCOUNT_KEY)
    }
  }
}

function upsertStoredAccountMetadata(record: AccountJournalRecord): void {
  const snapshot = Array.isArray(record.metadata.accounts)
    ? (record.metadata.accounts as StoredAccountRecord[])
    : []
  const entry = snapshot.find((account) => account?.id === record.accountId)
  if (!entry) {
    // No snapshot entry to roll forward to; fall back to rollback so we never leave a dangling
    // listing for an account we cannot fully describe.
    removeStoredAccountMetadata(record.accountId)
    return
  }

  const current = parseStoredAccounts()
  const index = current.findIndex((account) => account.id === record.accountId)
  if (index === -1) {
    current.push(entry)
  } else {
    current[index] = entry
  }
  writeStoredAccounts(current)
}

function isStoredAccountMetadataPresent(accountId: string): boolean {
  return parseStoredAccounts().some((account) => account.id === accountId)
}

/**
 * Resolve every account mutation a prior session left journaled (i.e. interrupted between its
 * IndexedDB and localStorage writes) back into a consistent state. Runs before
 * the store reads persisted metadata so the reactive refs observe already-reconciled storage.
 *
 * - `remove` is roll-forward only (deleting a secret is irreversible): ensure the secret is gone and
 *   the account is no longer listed.
 * - `add`/`update` roll forward when the mutation reached a durable store: either the secret landed,
 *   or (given the secret-before-metadata write order) the metadata listing landed, which means the
 *   whole mutation committed and the account is simply secret-less — e.g. an empty user session,
 *   whose vault secret is legitimately absent. They roll back (drop any dangling listing) only when
 *   neither store recorded the mutation, so a committed account is never deleted on reconcile.
 *
 * Each step is idempotent, so a reconcile that is itself interrupted simply resumes next startup.
 */
async function reconcileAccountJournal(): Promise<void> {
  const pending = await readPendingAccountJournal()

  for (const record of pending) {
    try {
      if (record.op === 'remove') {
        await deleteSecureAccountSecret(record.accountId)
        removeStoredAccountMetadata(record.accountId)
      } else if (
        (await hasSecureAccountSecret(record.accountId)) ||
        isStoredAccountMetadataPresent(record.accountId)
      ) {
        upsertStoredAccountMetadata(record)
      } else {
        removeStoredAccountMetadata(record.accountId)
      }
      await completeAccountJournal(record.id)
    } catch (error) {
      // Leave the entry in place; the next startup retries this idempotent reconciliation.
      console.error(`Failed to reconcile account journal entry ${record.id}:`, error)
    }
  }
}

export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<SavedAccount[]>([])
  const activeAccountId = ref<string | null>(null)
  const apiCredentials = ref<ApiCredentials | null>(null)
  const sessionStateByAccountId = ref<Record<string, AccountSessionState>>({})
  const storageLoaded = ref(false)
  // Ids of accounts whose encrypted secret failed to load/decrypt at startup. The account stays
  // visible from its plaintext metadata so a single corrupt record cannot hide the others; the user
  // can re-authenticate or remove it explicitly.
  const corruptedAccountIds = ref<string[]>([])

  // Monotonic per-account epoch. Removing an account advances its epoch before any archival runs, so
  // long-running jobs that captured the prior epoch fail their commit fence instead of writing an
  // owned record for an account that is being torn down.
  //
  // It is persisted per account in localStorage, which is synchronously consistent across same-origin
  // tabs: reading it at commit time therefore fences a late write whose account was removed in
  // another tab, without waiting for a `storage`/BroadcastChannel notification. The tombstone key is
  // intentionally never deleted on removal — the advanced value is what keeps fencing late writes for
  // that (never-reused) account id. Broader invalidation of a peer tab's *displayed* account state is
  // handled separately by the cross-tab channel below (reload on peer mutation).
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
  let reloadPromise: Promise<void> | null = null
  // Coalesces concurrent archive-recovery runs per account id so lifecycle triggers (add, activation,
  // startup) cannot race one another into duplicate recovery mutations.
  const recoveryInFlight = new Map<string, Promise<void>>()

  // Notify peer tabs after a committed mutation and reload when a peer notifies us, so no tab keeps
  // showing account/ownership state another tab has already changed. Falls back
  // to a no-op (reload-on-next-read) where BroadcastChannel is unavailable.
  const crossTab = createInvalidationChannel('telegram-toolset:accounts', () => {
    void reloadFromStorage()
  })

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
  const hasCorruptedAccounts = computed(() => corruptedAccountIds.value.length > 0)

  function isAccountCorrupted(id: string | null | undefined): boolean {
    return id != null && corruptedAccountIds.value.includes(id)
  }

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

  function clearCorruptedAccount(id: string): void {
    if (corruptedAccountIds.value.includes(id)) {
      corruptedAccountIds.value = corruptedAccountIds.value.filter(
        (corruptedId) => corruptedId !== id,
      )
    }
  }

  async function persistAccountSecret(account: SavedAccount): Promise<void> {
    await saveSecureAccountSecret(account.id, getPersistedAccountSecret(account))
  }

  /**
   * Capture the localStorage metadata a mutation intends to establish, for the write-ahead journal.
   * Taken after the in-memory refs are mutated so it reflects the intended post-success state.
   */
  function buildMetadataSnapshot(): AccountJournalEntryInput['metadata'] {
    return {
      accounts: accounts.value.map(serializeAccountMetadata),
      activeAccountId: activeAccountId.value,
    }
  }

  async function migrateLegacyPlaintextData(): Promise<void> {
    await Promise.all(accounts.value.map((account) => persistAccountSecret(account)))
    await saveSecureApiCredentials(apiCredentials.value)
    persistMetadataToLocalStorage()
  }

  /**
   * Read persisted metadata + secrets and publish them to the reactive refs. Shared by the initial
   * load and by cross-tab reloads. Legacy plaintext migration only runs on the initial load
   * (`migrate: true`); a reload is a pure read that must not perform storage writes.
   */
  async function applyStorageToState(options: { migrate: boolean }): Promise<void> {
    const storedAccounts = parseStoredAccounts()
    const legacyCredentials = parseStoredApiCredentials()

    let secureCredentials: ApiCredentials | null = null
    try {
      secureCredentials = await loadSecureApiCredentials()
    } catch (credentialsError) {
      // A corrupt/undecryptable credentials record must not hide every account. Drop the cached
      // credentials (the user re-enters them on next login) instead of failing the whole load.
      console.error('Failed to load secure API credentials:', credentialsError)
      secureCredentials = null
    }

    const nextApiCredentials =
      secureCredentials ?? legacyCredentials ?? getEmbeddedApiCredentials(storedAccounts)

    // Load API credentials before publishing accounts so reactive consumers never
    // observe a user account without the shared app credentials.
    apiCredentials.value = nextApiCredentials

    // Load each account's secret independently so a single corrupt/undecryptable record is
    // quarantined rather than rejecting the whole account list. A failed
    // record leaves the account visible (from plaintext metadata) for explicit re-auth or removal.
    const corruptedIds: string[] = []
    const secrets = await Promise.all(
      storedAccounts.map(async (account) => {
        try {
          return [account.id, await loadSecureAccountSecret(account.id)] as const
        } catch (secretError) {
          console.error(`Failed to load secure secret for account ${account.id}:`, secretError)
          corruptedIds.push(account.id)
          return [account.id, null] as const
        }
      }),
    )
    const secretByAccountId = new Map<string, PersistedAccountSecret | null>(secrets)

    accounts.value = storedAccounts.map((account) =>
      hydrateAccount(account, secretByAccountId.get(account.id) ?? null),
    )
    corruptedAccountIds.value = corruptedIds
    syncSessionStateMap()

    // A user account whose session secret failed to decrypt cannot connect; route it to the
    // explicit re-login path rather than leaving it in an ambiguous 'unknown' state.
    for (const corruptedId of corruptedIds) {
      const corruptedAccount = accounts.value.find((account) => account.id === corruptedId)
      if (corruptedAccount?.type === 'user') {
        sessionStateByAccountId.value[corruptedId] = 'needs_login'
      }
    }

    const storedActive = localStorage.getItem(ACTIVE_ACCOUNT_KEY)
    activeAccountId.value =
      storedActive && accounts.value.some((account) => account.id === storedActive)
        ? storedActive
        : null

    if (
      options.migrate &&
      (hasLegacyPlaintextData(storedAccounts, legacyCredentials !== null) ||
        (nextApiCredentials !== null && secureCredentials === null))
    ) {
      await migrateLegacyPlaintextData()
    }
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
        // Finish any account mutation a prior session left interrupted before reading persisted
        // state, so the reactive refs are hydrated from already-consistent storage. Reconcile
        // swallows its own per-entry errors and never throws, so a snag here cannot block boot.
        await reconcileAccountJournal()
        await applyStorageToState({ migrate: true })
        // Retry any archive recovery a prior session may have left incomplete for the account
        // restored as active. Fire-and-forget: boot must not block on a scan.
        const active = activeAccount.value
        if (active?.type === 'user') {
          void recoverAccountOwnedData(active)
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

  /**
   * Re-read persisted state after a peer tab reports a mutation. Defers to an
   * in-flight initial load (which reads the same fresh storage) and never re-broadcasts, so a reload
   * cannot loop back into other tabs.
   */
  async function reloadFromStorage(): Promise<void> {
    if (loadPromise) {
      return loadPromise
    }
    if (reloadPromise) {
      return reloadPromise
    }

    reloadPromise = (async () => {
      try {
        await applyStorageToState({ migrate: false })
      } catch (error) {
        console.error('Failed to reload accounts after cross-tab invalidation:', error)
      } finally {
        reloadPromise = null
      }
    })()

    return reloadPromise
  }

  /**
   * Reclaim archived backups and chat exports for a user account. Recovery
   * is an explicit lifecycle step — triggered on add, activation, and startup — rather than a hidden
   * side effect of a list read, so it never races a concurrent list. Runs are coalesced per account
   * id and swallow their own errors: a failed reclaim must not fail the login/activation that
   * triggered it (the archived data stays recoverable and is retried on the next lifecycle event).
   */
  function recoverAccountOwnedData(account: SavedAccount): Promise<void> {
    if (account.type !== 'user') {
      return Promise.resolve()
    }

    const existing = recoveryInFlight.get(account.id)
    if (existing) {
      return existing
    }

    const run = (async () => {
      try {
        const [{ backupManager }, { chatHistoryService }] = await Promise.all([
          import('@/services/storage/backup-manager'),
          import('@/services/llm-export/chat-history-service'),
        ])

        await Promise.all([
          backupManager.recoverArchivedBackupsForAccount(account),
          chatHistoryService.recoverArchivedChatExportsForAccount(account),
        ])
      } catch (error) {
        console.error('Failed to recover account-owned data:', error)
      } finally {
        recoveryInFlight.delete(account.id)
      }
    })()

    recoveryInFlight.set(account.id, run)
    return run
  }

  async function setApiCredentials(credentials: ApiCredentials): Promise<void> {
    const previousCredentials = apiCredentials.value
    apiCredentials.value = credentials

    try {
      await saveSecureApiCredentials(credentials)
      persistMetadataToLocalStorage()
      crossTab.post()
    } catch (error) {
      apiCredentials.value = previousCredentials
      throw error
    }
  }

  /**
   * Explicitly clear the shared stored API credentials. Available from the
   * account-independent local-data workspace so retained credentials can be removed even with no
   * account present.
   */
  async function clearApiCredentials(): Promise<void> {
    const previousCredentials = apiCredentials.value
    apiCredentials.value = null

    try {
      await saveSecureApiCredentials(null)
      persistMetadataToLocalStorage()
      crossTab.post()
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

    const journalId = await beginAccountJournal({
      op: 'add',
      accountId: newAccount.id,
      metadata: buildMetadataSnapshot(),
    })

    try {
      await persistAccountSecret(newAccount)
      persistMetadataToLocalStorage()
      await completeAccountJournal(journalId)
      crossTab.post()
      if (newAccount.type === 'user') {
        // Reclaim any archived data for this identity before the caller navigates to a list view, so
        // a re-login surfaces the account's prior backups/exports.
        await recoverAccountOwnedData(newAccount)
      }
      return newAccount
    } catch (error) {
      accounts.value = accounts.value.filter(
        (existingAccount) => existingAccount.id !== newAccount.id,
      )
      delete sessionStateByAccountId.value[newAccount.id]
      // Undo any orphaned secret the partial add may have written, then drop the journal so startup
      // reconciliation does not resurrect a mutation the caller just saw fail.
      await deleteSecureAccountSecret(newAccount.id).catch(() => {})
      await completeAccountJournal(journalId)
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

    const journalId = await beginAccountJournal({
      op: 'update',
      accountId: id,
      metadata: buildMetadataSnapshot(),
    })

    try {
      await persistAccountSecret(nextAccount)
      persistMetadataToLocalStorage()
      // Writing a fresh secret repairs a previously corrupt record.
      clearCorruptedAccount(id)
      await completeAccountJournal(journalId)
      crossTab.post()
    } catch (error) {
      accounts.value[index] = previousAccount
      // The pre-existing secret keeps the account usable; clearing the journal prevents startup from
      // re-applying the metadata this failed update rolled back in memory.
      await completeAccountJournal(journalId)
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
    // already scanned the store. Rolled back if removal aborts.
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

    const journalId = await beginAccountJournal({
      op: 'remove',
      accountId: id,
      metadata: buildMetadataSnapshot(),
    })

    try {
      await deleteSecureAccountSecret(id)
      persistMetadataToLocalStorage()
      clearCorruptedAccount(id)
      await completeAccountJournal(journalId)
      crossTab.post()
    } catch (error) {
      // A removal is only reversible while the secret still exists. Probe to decide which way to
      // resolve rather than blindly restoring a possibly-secretless "ghost" account.
      let secretStillExists = false
      try {
        secretStillExists = await hasSecureAccountSecret(id)
      } catch {
        secretStillExists = false
      }

      if (secretStillExists) {
        // The secret delete never landed — roll the whole removal back.
        accounts.value = previousAccounts
        activeAccountId.value = previousActiveAccountId
        sessionStateByAccountId.value = previousSessionState
        restoreAccountEpoch(id, previousEpoch)
        await completeAccountJournal(journalId)
        throw error
      }

      // The secret is gone: the removal is past the point of no return. Keep the account removed and
      // leave the journal so startup reconciliation finishes clearing its metadata.
      console.error('Failed to finish removing account after its secret was deleted:', error)
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
      crossTab.post()
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
    corruptedAccountIds,
    hasCorruptedAccounts,
    isAccountCorrupted,
    loadFromStorage,
    reloadFromStorage,
    recoverAccountOwnedData,
    addAccount,
    updateAccount,
    removeAccount,
    setActiveAccount,
    setApiCredentials,
    clearApiCredentials,
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
