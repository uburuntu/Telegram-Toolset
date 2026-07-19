import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { useAccountsStore } from '@/stores/accounts'
import type { SavedAccount } from '@/types/account'

const vaultState = vi.hoisted(() => ({
  apiCredentials: null as { apiId: number; apiHash: string } | null,
  accountSecrets: new Map<string, { sessionString?: string; botToken?: string }>(),
}))

const vaultApi = vi.hoisted(() => ({
  loadSecureApiCredentials: vi.fn(async () => vaultState.apiCredentials),
  saveSecureApiCredentials: vi.fn(
    async (credentials: { apiId: number; apiHash: string } | null) => {
      vaultState.apiCredentials = credentials
    },
  ),
  loadSecureAccountSecret: vi.fn(async (accountId: string) => {
    return vaultState.accountSecrets.get(accountId) ?? null
  }),
  saveSecureAccountSecret: vi.fn(
    async (accountId: string, secret: { sessionString?: string; botToken?: string } | null) => {
      if (secret) {
        vaultState.accountSecrets.set(accountId, secret)
      } else {
        vaultState.accountSecrets.delete(accountId)
      }
    },
  ),
  deleteSecureAccountSecret: vi.fn(async (accountId: string) => {
    vaultState.accountSecrets.delete(accountId)
  }),
  hasSecureAccountSecret: vi.fn(async (accountId: string) => {
    return vaultState.accountSecrets.has(accountId)
  }),
}))

const backupManagerApi = vi.hoisted(() => ({
  archiveBackupsForRemovedAccount: vi.fn(async () => 0),
  recoverArchivedBackupsForAccount: vi.fn(async () => 0),
}))

const chatHistoryServiceApi = vi.hoisted(() => ({
  archiveChatExportsForRemovedAccount: vi.fn(async () => 0),
  recoverArchivedChatExportsForAccount: vi.fn(async () => 0),
}))

// Capture the store's cross-tab wiring: the callback it registers (invoked to simulate a peer tab
// reporting a change) and a spy on the invalidations it posts after its own mutations.
const crossTabState = vi.hoisted(() => ({
  onInvalidated: null as null | (() => void),
  post: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@/services/storage/secure-account-vault', () => vaultApi)
vi.mock('@/services/storage/backup-manager', () => ({
  backupManager: backupManagerApi,
}))
vi.mock('@/services/llm-export/chat-history-service', () => ({
  chatHistoryService: chatHistoryServiceApi,
}))
vi.mock('@/services/storage/cross-tab', () => ({
  createInvalidationChannel: (_name: string, onInvalidated: () => void) => {
    crossTabState.onInvalidated = onInvalidated
    return { post: crossTabState.post, close: crossTabState.close }
  },
}))

describe('accounts store', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = new Map()
    vaultState.apiCredentials = null
    vaultState.accountSecrets.clear()
    crossTabState.onInvalidated = null
    vi.clearAllMocks()

    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key)
      }),
      clear: vi.fn(() => {
        storage.clear()
      }),
    })

    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads API credentials before publishing the active account', async () => {
    localStorage.setItem(
      'telegram_accounts',
      JSON.stringify([
        {
          id: 'user-1',
          type: 'user',
          label: 'Test User',
          phone: '+1234567890',
          createdAt: '2026-04-20T10:00:00.000Z',
          lastUsedAt: '2026-04-24T10:00:00.000Z',
        },
      ]),
    )
    localStorage.setItem('telegram_active_account', 'user-1')

    vaultState.apiCredentials = {
      apiId: 123456,
      apiHash: 'test-api-hash',
    }
    vaultState.accountSecrets.set('user-1', { sessionString: 'saved-session' })

    const store = useAccountsStore()
    const observedCredentials: Array<{ apiId: number; apiHash: string } | null> = []

    watch(
      () => store.activeAccount?.id,
      () => {
        observedCredentials.push(
          store.apiCredentials
            ? {
                apiId: store.apiCredentials.apiId,
                apiHash: store.apiCredentials.apiHash,
              }
            : null,
        )
      },
      { flush: 'sync' },
    )

    await store.loadFromStorage()

    expect(store.activeAccount?.id).toBe('user-1')
    expect(store.activeAccount?.sessionString).toBe('saved-session')
    expect(store.apiCredentials).toEqual({
      apiId: 123456,
      apiHash: 'test-api-hash',
    })
    expect(observedCredentials).toEqual([
      {
        apiId: 123456,
        apiHash: 'test-api-hash',
      },
    ])
  })

  it('migrates legacy plaintext secrets into the secure vault and strips localStorage', async () => {
    localStorage.setItem(
      'telegram_accounts',
      JSON.stringify([
        {
          id: 'user-1',
          type: 'user',
          label: 'Test User',
          phone: '+1234567890',
          sessionString: 'saved-session',
          createdAt: '2026-04-20T10:00:00.000Z',
          lastUsedAt: '2026-04-24T10:00:00.000Z',
        },
        {
          id: 'bot-1',
          type: 'bot',
          label: 'My Bot',
          botToken: '123456:secret-token',
          botTelegramId: 42,
          createdAt: '2026-04-20T10:00:00.000Z',
          lastUsedAt: '2026-04-24T10:00:00.000Z',
        },
      ]),
    )
    localStorage.setItem(
      'telegram_api_credentials',
      JSON.stringify({
        apiId: 123456,
        apiHash: 'test-api-hash',
      }),
    )

    const store = useAccountsStore()
    await store.loadFromStorage()

    expect(vaultState.apiCredentials).toEqual({
      apiId: 123456,
      apiHash: 'test-api-hash',
    })
    expect(vaultState.accountSecrets.get('user-1')).toEqual({
      sessionString: 'saved-session',
    })
    expect(vaultState.accountSecrets.get('bot-1')).toEqual({
      botToken: '123456:secret-token',
    })

    const persistedAccounts = JSON.parse(localStorage.getItem('telegram_accounts') ?? '[]')
    expect(persistedAccounts).toEqual([
      {
        id: 'user-1',
        type: 'user',
        label: 'Test User',
        phone: '+1234567890',
        createdAt: '2026-04-20T10:00:00.000Z',
        lastUsedAt: '2026-04-24T10:00:00.000Z',
      },
      {
        id: 'bot-1',
        type: 'bot',
        label: 'My Bot',
        botTelegramId: 42,
        createdAt: '2026-04-20T10:00:00.000Z',
        lastUsedAt: '2026-04-24T10:00:00.000Z',
      },
    ])
    expect(localStorage.getItem('telegram_api_credentials')).toBeNull()
  })

  it('persists new accounts and credentials without writing secrets to localStorage', async () => {
    const store = useAccountsStore()

    await store.setApiCredentials({
      apiId: 123456,
      apiHash: 'test-api-hash',
    })

    const account = await store.addAccount({
      type: 'user',
      label: 'Test User',
      phone: '+1234567890',
      sessionString: 'saved-session',
    })

    expect(vaultState.apiCredentials).toEqual({
      apiId: 123456,
      apiHash: 'test-api-hash',
    })
    expect(vaultState.accountSecrets.get(account.id)).toEqual({
      sessionString: 'saved-session',
    })

    const persistedAccounts = JSON.parse(localStorage.getItem('telegram_accounts') ?? '[]')
    expect(persistedAccounts).toHaveLength(1)
    expect(persistedAccounts[0]).toMatchObject({
      id: account.id,
      type: 'user',
      label: 'Test User',
      phone: '+1234567890',
    })
    expect(persistedAccounts[0].sessionString).toBeUndefined()
    expect(localStorage.getItem('telegram_api_credentials')).toBeNull()
  })

  it('undoes a partial add when persisting metadata fails, leaving no orphaned secret', async () => {
    const store = useAccountsStore()

    // Fail the localStorage metadata write that follows the (successful) secret write, so the add
    // partially commits: the secret lands in the vault before persistence throws.
    ;(localStorage.setItem as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('quota exceeded')
    })

    await expect(
      store.addAccount({
        type: 'user',
        label: 'Test User',
        phone: '+1234567890',
        sessionString: 'saved-session',
      }),
    ).rejects.toThrow('quota exceeded')

    // In-memory state is rolled back and the orphaned secret is compensated away (§6): failure at
    // the add boundary leaves no half-committed account behind.
    expect(store.accounts).toHaveLength(0)
    expect(vaultState.accountSecrets.size).toBe(0)
  })

  it('tracks selected accounts separately from login-required state', async () => {
    const store = useAccountsStore()
    const account = await store.addAccount({
      type: 'user',
      label: 'Test User',
      phone: '+1234567890',
      sessionString: 'saved-session',
    })

    store.setActiveAccount(account.id)
    expect(store.activeAccount?.id).toBe(account.id)
    expect(store.activeAccountNeedsLogin).toBe(false)

    store.markAccountNeedsLogin(account.id)
    expect(store.getAccountSessionState(account.id)).toBe('needs_login')
    expect(store.activeAccountNeedsLogin).toBe(true)

    store.markAccountSessionReady(account.id)
    expect(store.getAccountSessionState(account.id)).toBe('ready')
    expect(store.activeAccountNeedsLogin).toBe(false)
  })

  it('archives account-owned data before removing a user account', async () => {
    const store = useAccountsStore()
    const account = await store.addAccount({
      type: 'user',
      label: 'Test User',
      phone: '+1234567890',
      sessionString: 'saved-session',
    })

    await store.removeAccount(account.id)

    expect(backupManagerApi.archiveBackupsForRemovedAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: account.id,
        phone: '+1234567890',
      }),
    )
    expect(chatHistoryServiceApi.archiveChatExportsForRemovedAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: account.id,
        phone: '+1234567890',
      }),
    )
    expect(vaultState.accountSecrets.has(account.id)).toBe(false)
    expect(store.accounts).toHaveLength(0)
  })

  it('starts every account at epoch 0 and advances it when the account is removed', async () => {
    const store = useAccountsStore()
    const account = await store.addAccount({
      type: 'user',
      label: 'Test User',
      phone: '+1234567890',
      sessionString: 'saved-session',
    })

    expect(store.getAccountEpoch(account.id)).toBe(0)

    await store.removeAccount(account.id)

    expect(store.getAccountEpoch(account.id)).toBe(1)
  })

  it('rolls the account epoch back when archival fails and the account survives', async () => {
    backupManagerApi.archiveBackupsForRemovedAccount.mockRejectedValueOnce(
      new Error('archive failed'),
    )

    const store = useAccountsStore()
    const account = await store.addAccount({
      type: 'user',
      label: 'Test User',
      phone: '+1234567890',
      sessionString: 'saved-session',
    })

    await expect(store.removeAccount(account.id)).rejects.toThrow('archive failed')

    expect(store.accounts).toHaveLength(1)
    expect(store.getAccountEpoch(account.id)).toBe(0)
  })

  it('reads an epoch advance made by another tab (durable cross-tab fence)', async () => {
    const store = useAccountsStore()
    const account = await store.addAccount({
      type: 'user',
      label: 'Test User',
      phone: '+1234567890',
      sessionString: 'saved-session',
    })

    const capturedAtJobStart = store.getAccountEpoch(account.id)
    expect(capturedAtJobStart).toBe(0)

    // Another tab removes the account and advances the durable, localStorage-backed epoch.
    storage.set(`telegram_account_epoch:${account.id}`, '1')

    expect(store.getAccountEpoch(account.id)).toBe(1)
    // A commit fence comparing the captured epoch would now reject the stale write.
    expect(store.getAccountEpoch(account.id)).not.toBe(capturedAtJobStart)
  })

  it('rolls the account epoch back when secret deletion fails during removal', async () => {
    vaultApi.deleteSecureAccountSecret.mockRejectedValueOnce(new Error('secret delete failed'))

    const store = useAccountsStore()
    const account = await store.addAccount({
      type: 'user',
      label: 'Test User',
      phone: '+1234567890',
      sessionString: 'saved-session',
    })

    await expect(store.removeAccount(account.id)).rejects.toThrow('secret delete failed')

    expect(store.accounts).toHaveLength(1)
    expect(store.getAccountEpoch(account.id)).toBe(0)
  })

  it('persists the Telegram principal and finds accounts by it', async () => {
    const store = useAccountsStore()
    const account = await store.addAccount({
      type: 'user',
      label: 'Principal User',
      phone: '+1234567890',
      principal: { kind: 'user', telegramUserId: '555' },
      sessionString: 'saved-session',
    })

    expect(store.findUserAccountByPrincipal({ kind: 'user', telegramUserId: '555' })?.id).toBe(
      account.id,
    )
    expect(store.findAccountByPrincipal({ kind: 'user', telegramUserId: '555' })?.id).toBe(
      account.id,
    )
    // Kind is part of identity: a bot with the same numeric ID must not match a user principal.
    expect(store.findUserAccountByPrincipal({ kind: 'bot', telegramUserId: '555' })).toBeNull()
    expect(store.findUserAccountByPrincipal({ kind: 'user', telegramUserId: '999' })).toBeNull()

    const persisted = JSON.parse(localStorage.getItem('telegram_accounts') ?? '[]')
    expect(persisted[0].principal).toEqual({ kind: 'user', telegramUserId: '555' })
  })

  it('rehydrates the principal from stored metadata', async () => {
    localStorage.setItem(
      'telegram_accounts',
      JSON.stringify([
        {
          id: 'user-1',
          type: 'user',
          label: 'Test User',
          phone: '+1234567890',
          principal: { kind: 'user', telegramUserId: '777' },
          createdAt: '2026-04-20T10:00:00.000Z',
          lastUsedAt: '2026-04-24T10:00:00.000Z',
        },
      ]),
    )

    const store = useAccountsStore()
    await store.loadFromStorage()

    expect(store.accounts[0]?.principal).toEqual({ kind: 'user', telegramUserId: '777' })
    expect(store.findUserAccountByPrincipal({ kind: 'user', telegramUserId: '777' })?.id).toBe(
      'user-1',
    )
  })

  describe('corrupt-secret load resilience', () => {
    function seedTwoUserAccounts(): void {
      localStorage.setItem(
        'telegram_accounts',
        JSON.stringify([
          {
            id: 'good',
            type: 'user',
            label: 'Good',
            phone: '+1000000000',
            createdAt: '2026-04-20T10:00:00.000Z',
            lastUsedAt: '2026-04-24T10:00:00.000Z',
          },
          {
            id: 'bad',
            type: 'user',
            label: 'Bad',
            phone: '+2000000000',
            createdAt: '2026-04-20T10:00:00.000Z',
            lastUsedAt: '2026-04-24T10:00:00.000Z',
          },
        ]),
      )
    }

    it('keeps other accounts visible when one secret fails to decrypt', async () => {
      seedTwoUserAccounts()
      vaultState.accountSecrets.set('good', { sessionString: 'good-session' })
      vaultApi.loadSecureAccountSecret.mockImplementation(async (accountId: string) => {
        if (accountId === 'bad') {
          throw new Error('decrypt failed')
        }
        return vaultState.accountSecrets.get(accountId) ?? null
      })

      const store = useAccountsStore()
      await store.loadFromStorage()

      expect(store.accounts).toHaveLength(2)
      expect(store.accounts.find((account) => account.id === 'good')?.sessionString).toBe(
        'good-session',
      )
      expect(store.isAccountCorrupted('bad')).toBe(true)
      expect(store.isAccountCorrupted('good')).toBe(false)
      expect(store.hasCorruptedAccounts).toBe(true)
      // A corrupt user account routes to the explicit re-login path.
      expect(store.getAccountSessionState('bad')).toBe('needs_login')
    })

    it('does not hide accounts when the vault master key itself is unreadable', async () => {
      seedTwoUserAccounts()
      vaultApi.loadSecureApiCredentials.mockRejectedValueOnce(new Error('vault key missing'))
      vaultApi.loadSecureAccountSecret.mockRejectedValue(new Error('vault key missing'))

      const store = useAccountsStore()
      await store.loadFromStorage()

      expect(store.accounts).toHaveLength(2)
      expect(store.corruptedAccountIds).toEqual(expect.arrayContaining(['good', 'bad']))
    })

    it('clears the corrupt flag after the account is re-authenticated', async () => {
      seedTwoUserAccounts()
      vaultApi.loadSecureAccountSecret.mockImplementation(async (accountId: string) => {
        if (accountId === 'bad') {
          throw new Error('decrypt failed')
        }
        return vaultState.accountSecrets.get(accountId) ?? null
      })

      const store = useAccountsStore()
      await store.loadFromStorage()
      expect(store.isAccountCorrupted('bad')).toBe(true)

      await store.updateAccount('bad', { sessionString: 'recovered-session' })

      expect(store.isAccountCorrupted('bad')).toBe(false)
      expect(store.hasCorruptedAccounts).toBe(false)
    })

    it('clears the corrupt flag after the account is removed', async () => {
      seedTwoUserAccounts()
      vaultApi.loadSecureAccountSecret.mockImplementation(async (accountId: string) => {
        if (accountId === 'bad') {
          throw new Error('decrypt failed')
        }
        return vaultState.accountSecrets.get(accountId) ?? null
      })

      const store = useAccountsStore()
      await store.loadFromStorage()
      expect(store.isAccountCorrupted('bad')).toBe(true)

      await store.removeAccount('bad')

      expect(store.isAccountCorrupted('bad')).toBe(false)
      expect(store.accounts.map((account) => account.id)).toEqual(['good'])
    })
  })

  describe('cross-tab invalidation', () => {
    function writeStoredAccounts(ids: string[]): void {
      localStorage.setItem(
        'telegram_accounts',
        JSON.stringify(
          ids.map((id) => ({
            id,
            type: 'user',
            label: id,
            phone: `+1${id}`,
            createdAt: '2026-04-20T10:00:00.000Z',
            lastUsedAt: '2026-04-24T10:00:00.000Z',
          })),
        ),
      )
    }

    it('posts an invalidation after committing a mutation', async () => {
      const store = useAccountsStore()
      await store.loadFromStorage()

      await store.addAccount({
        type: 'user',
        label: 'New',
        phone: '+1999999999',
        sessionString: 'new-session',
      })

      expect(crossTabState.post).toHaveBeenCalled()
    })

    it('wires the invalidation callback that reloads state', () => {
      useAccountsStore()
      expect(crossTabState.onInvalidated).toBeTypeOf('function')
    })

    it('reloads in-memory state when a peer tab reports a change', async () => {
      writeStoredAccounts(['good'])
      localStorage.setItem('telegram_active_account', 'good')
      vaultState.accountSecrets.set('good', { sessionString: 'good-session' })

      const store = useAccountsStore()
      await store.loadFromStorage()
      expect(store.accounts).toHaveLength(1)

      // Simulate another tab adding + activating a second account by writing shared storage directly.
      writeStoredAccounts(['good', 'peer'])
      localStorage.setItem('telegram_active_account', 'peer')
      vaultState.accountSecrets.set('peer', { sessionString: 'peer-session' })

      crossTabState.post.mockClear()
      crossTabState.onInvalidated?.()
      await store.reloadFromStorage()

      expect(store.accounts.map((account) => account.id)).toEqual(['good', 'peer'])
      expect(store.activeAccountId).toBe('peer')
      // A reload triggered by a peer must not echo back into the channel.
      expect(crossTabState.post).not.toHaveBeenCalled()
    })

    it('drops an account a peer tab removed', async () => {
      writeStoredAccounts(['good', 'peer'])
      localStorage.setItem('telegram_active_account', 'peer')
      vaultState.accountSecrets.set('good', { sessionString: 'good-session' })
      vaultState.accountSecrets.set('peer', { sessionString: 'peer-session' })

      const store = useAccountsStore()
      await store.loadFromStorage()
      expect(store.accounts).toHaveLength(2)

      // Peer removes 'peer' and re-points the active selection at the survivor.
      writeStoredAccounts(['good'])
      localStorage.setItem('telegram_active_account', 'good')
      vaultState.accountSecrets.delete('peer')

      await store.reloadFromStorage()

      expect(store.accounts.map((account) => account.id)).toEqual(['good'])
      expect(store.activeAccountId).toBe('good')
    })
  })

  describe('archive recovery lifecycle', () => {
    it('reclaims archived data when a user account is added', async () => {
      const store = useAccountsStore()
      await store.loadFromStorage()

      const account = await store.addAccount({
        type: 'user',
        label: 'Reinstalled',
        phone: '+1555000000',
        sessionString: 'session',
      })

      expect(backupManagerApi.recoverArchivedBackupsForAccount).toHaveBeenCalledWith(
        expect.objectContaining({ id: account.id }),
      )
      expect(chatHistoryServiceApi.recoverArchivedChatExportsForAccount).toHaveBeenCalledWith(
        expect.objectContaining({ id: account.id }),
      )
    })

    it('does not run archive recovery for bot accounts', async () => {
      const store = useAccountsStore()
      await store.loadFromStorage()

      await store.addAccount({
        type: 'bot',
        label: 'Bot',
        botToken: '123:abc',
        sessionString: 'bot_session',
      })

      expect(backupManagerApi.recoverArchivedBackupsForAccount).not.toHaveBeenCalled()
      expect(chatHistoryServiceApi.recoverArchivedChatExportsForAccount).not.toHaveBeenCalled()
    })

    it('coalesces concurrent recovery runs for the same account', async () => {
      const store = useAccountsStore()
      await store.loadFromStorage()

      const account: SavedAccount = {
        id: 'coalesce',
        type: 'user',
        label: 'Coalesce',
        phone: '+1666000000',
        sessionString: 'session',
        createdAt: new Date(),
        lastUsedAt: new Date(),
      }

      await Promise.all([
        store.recoverAccountOwnedData(account),
        store.recoverAccountOwnedData(account),
      ])

      expect(backupManagerApi.recoverArchivedBackupsForAccount).toHaveBeenCalledTimes(1)
      expect(chatHistoryServiceApi.recoverArchivedChatExportsForAccount).toHaveBeenCalledTimes(1)
    })
  })
})
