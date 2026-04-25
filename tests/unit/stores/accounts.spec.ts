import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { useAccountsStore } from '@/stores/accounts'

describe('accounts store', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = new Map()
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
    vi.clearAllMocks()
  })

  it('loads API credentials before publishing the active account', () => {
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
      ]),
    )
    localStorage.setItem('telegram_active_account', 'user-1')
    localStorage.setItem(
      'telegram_api_credentials',
      JSON.stringify({
        apiId: 123456,
        apiHash: 'test-api-hash',
      }),
    )

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

    store.loadFromStorage()

    expect(store.activeAccount?.id).toBe('user-1')
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

  it('tracks selected accounts separately from login-required state', () => {
    const store = useAccountsStore()
    const account = store.addAccount({
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
