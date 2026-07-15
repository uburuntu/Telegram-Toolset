import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useActiveUserSessionSync } from '@/composables/useActiveUserSessionSync'
import { resendService } from '@/services/resend/resend-service'
import { telegramService } from '@/services/telegram/client'
import { useAccountsStore } from '@/stores'

vi.mock('@/services/resend/resend-service', () => ({
  resendService: {
    cancelAndWait: vi.fn(),
  },
}))

vi.mock('@/services/telegram/client', () => ({
  telegramService: (() => {
    let transitionGeneration = 0
    return {
      beginActiveAccountTransition: vi.fn(() => ++transitionGeneration),
      completeActiveAccountTransition: vi.fn(),
      disconnect: vi.fn(),
      useUserAccountSession: vi.fn(),
    }
  })(),
}))

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

describe('useActiveUserSessionSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setActivePinia(createPinia())

    const accountsStore = useAccountsStore()
    accountsStore.accounts = [accountA, accountB]
    accountsStore.activeAccountId = accountA.id
    accountsStore.apiCredentials = {
      apiId: 123456,
      apiHash: '0123456789abcdef',
    }

    vi.mocked(resendService.cancelAndWait).mockResolvedValue(true)
    vi.mocked(telegramService.useUserAccountSession).mockResolvedValue(true)
  })

  it('waits for a cancelled resend before replacing the Telegram session', async () => {
    let releaseResend!: () => void
    vi.mocked(resendService.cancelAndWait).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseResend = resolve
        }),
    )

    const scope = effectScope()
    scope.run(() => useActiveUserSessionSync(ref(false)))
    expect(telegramService.beginActiveAccountTransition).toHaveBeenCalledTimes(1)
    await flushPromises()

    expect(resendService.cancelAndWait).toHaveBeenCalledTimes(1)
    expect(telegramService.useUserAccountSession).not.toHaveBeenCalled()

    releaseResend()
    await flushPromises()

    expect(telegramService.useUserAccountSession).toHaveBeenCalledWith({
      accountId: accountA.id,
      sessionString: accountA.sessionString,
      apiId: 123456,
      apiHash: '0123456789abcdef',
    })
    expect(telegramService.completeActiveAccountTransition).toHaveBeenCalledTimes(1)
    scope.stop()
  })

  it('serializes rapid account changes and finishes on the latest account', async () => {
    let releaseFirstSession!: () => void
    vi.mocked(telegramService.useUserAccountSession).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseFirstSession = () => resolve(true)
        }),
    )

    const scope = effectScope()
    scope.run(() => useActiveUserSessionSync(ref(false)))
    await flushPromises()
    expect(telegramService.useUserAccountSession).toHaveBeenCalledTimes(1)

    const accountsStore = useAccountsStore()
    accountsStore.activeAccountId = accountB.id
    await flushPromises()
    expect(telegramService.useUserAccountSession).toHaveBeenCalledTimes(1)

    releaseFirstSession()
    await flushPromises()

    expect(telegramService.useUserAccountSession).toHaveBeenLastCalledWith({
      accountId: accountB.id,
      sessionString: accountB.sessionString,
      apiId: 123456,
      apiHash: '0123456789abcdef',
    })
    scope.stop()
  })

  it('disconnects when the active account transitions to needs-login', async () => {
    const scope = effectScope()
    scope.run(() => useActiveUserSessionSync(ref(false)))
    await flushPromises()

    vi.clearAllMocks()
    vi.mocked(resendService.cancelAndWait).mockResolvedValue(true)
    const accountsStore = useAccountsStore()
    accountsStore.markAccountNeedsLogin(accountA.id)
    await flushPromises()

    expect(resendService.cancelAndWait).toHaveBeenCalledTimes(1)
    expect(telegramService.disconnect).toHaveBeenCalledTimes(1)
    expect(telegramService.useUserAccountSession).not.toHaveBeenCalled()
    scope.stop()
  })
})
