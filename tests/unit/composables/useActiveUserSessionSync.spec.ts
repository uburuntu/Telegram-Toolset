import { createPinia, setActivePinia } from 'pinia'
import { computed, effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useActiveUserSessionSync } from '@/composables/useActiveUserSessionSync'
import type { DesiredSession } from '@/services/telegram/session-coordinator'
import { sessionCoordinator } from '@/services/telegram/session-coordinator-instance'
import { useAccountsStore } from '@/stores'

vi.mock('@/services/telegram/session-coordinator-instance', () => ({
  sessionCoordinator: {
    requestSync: vi.fn(),
  },
}))

const requestSync = vi.mocked(sessionCoordinator.requestSync)

function lastRequest(): DesiredSession {
  const calls = requestSync.mock.calls
  return calls[calls.length - 1][0]
}

const accountA = {
  id: 'account-a',
  type: 'user' as const,
  label: 'Account A',
  phone: '+10000000001',
  sessionString: 'session-a',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
}

const accountB = {
  ...accountA,
  id: 'account-b',
  label: 'Account B',
  phone: '+10000000002',
  sessionString: 'session-b',
}

const botAccount = {
  ...accountA,
  id: 'bot-a',
  type: 'bot' as const,
  label: 'Bot A',
  botToken: 'token',
}

describe('useActiveUserSessionSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setActivePinia(createPinia())

    const accountsStore = useAccountsStore()
    accountsStore.accounts = [accountA, accountB, botAccount]
    accountsStore.activeAccountId = accountA.id
    accountsStore.apiCredentials = { apiId: 123456, apiHash: '0123456789abcdef' }
  })

  it('requests activation for the active user account with shared credentials', () => {
    const scope = effectScope()
    scope.run(() => useActiveUserSessionSync(ref(false)))

    expect(lastRequest()).toEqual({
      kind: 'activate',
      request: {
        accountId: accountA.id,
        sessionString: accountA.sessionString,
        credentials: { apiId: 123456, apiHash: '0123456789abcdef' },
      },
    })
    scope.stop()
  })

  it('re-requests activation when the active account changes', () => {
    const accountsStore = useAccountsStore()
    const scope = effectScope()
    scope.run(() => useActiveUserSessionSync(ref(false)))

    accountsStore.activeAccountId = accountB.id

    expect(lastRequest()).toMatchObject({ kind: 'activate', request: { accountId: accountB.id } })
    scope.stop()
  })

  it('requests teardown when the active account needs login', () => {
    const accountsStore = useAccountsStore()
    const scope = effectScope()
    scope.run(() => useActiveUserSessionSync(ref(false)))

    accountsStore.markAccountNeedsLogin(accountA.id)

    expect(lastRequest()).toEqual({ kind: 'teardown' })
    scope.stop()
  })

  it('requests teardown when the active account is a bot', () => {
    const accountsStore = useAccountsStore()
    accountsStore.activeAccountId = botAccount.id
    const scope = effectScope()
    scope.run(() => useActiveUserSessionSync(ref(false)))

    expect(lastRequest()).toEqual({ kind: 'teardown' })
    scope.stop()
  })

  it('holds while a login modal owns the session', () => {
    const showLoginModal = ref(true)
    const scope = effectScope()
    scope.run(() => useActiveUserSessionSync(computed(() => showLoginModal.value)))

    expect(lastRequest()).toEqual({ kind: 'hold' })
    scope.stop()
  })

  it('holds when shared credentials are missing', () => {
    const accountsStore = useAccountsStore()
    accountsStore.apiCredentials = null
    const scope = effectScope()
    scope.run(() => useActiveUserSessionSync(ref(false)))

    expect(lastRequest()).toEqual({ kind: 'hold' })
    scope.stop()
  })
})
