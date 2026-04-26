import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { useAccountsStore } from '@/stores/accounts'

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
}))

vi.mock('@/services/storage/secure-account-vault', () => vaultApi)

describe('accounts store', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = new Map()
    vaultState.apiCredentials = null
    vaultState.accountSecrets.clear()
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
})
