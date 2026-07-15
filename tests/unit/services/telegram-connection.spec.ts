import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { telegramService } from '@/services/telegram/client'
import { useAccountsStore } from '@/stores'

describe('telegramService connection state', () => {
  const service = telegramService as any
  const originalClient = service.client
  const originalCurrentUser = service.currentUser
  const originalConnectionState = service._connectionState
  const originalEntityCache = service.entityCache
  const originalReconnectAttempts = service.reconnectAttempts
  const originalActiveAccountInitPromise = service._activeAccountInitPromise
  const originalActiveAccountInitKey = service._activeAccountInitKey
  const originalActiveSessionAccountId = service._activeSessionAccountId
  const originalAccountTransitionGeneration = service._accountTransitionGeneration
  const originalAccountTransitionPromise = service._accountTransitionPromise
  const originalCompleteAccountTransition = service._completeAccountTransition

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setActivePinia(createPinia())
    service.client = null
    service.currentUser = null
    service._connectionState = 'disconnected'
    service.entityCache = new Map()
    service.reconnectAttempts = 0
    service._activeAccountInitPromise = null
    service._activeAccountInitKey = null
    service._activeSessionAccountId = null
    service._accountTransitionGeneration = 0
    service._accountTransitionPromise = null
    service._completeAccountTransition = null
  })

  afterEach(() => {
    service.client = originalClient
    service.currentUser = originalCurrentUser
    service._connectionState = originalConnectionState
    service.entityCache = originalEntityCache
    service.reconnectAttempts = originalReconnectAttempts
    service._activeAccountInitPromise = originalActiveAccountInitPromise
    service._activeAccountInitKey = originalActiveAccountInitKey
    service._activeSessionAccountId = originalActiveSessionAccountId
    service._accountTransitionGeneration = originalAccountTransitionGeneration
    service._accountTransitionPromise = originalAccountTransitionPromise
    service._completeAccountTransition = originalCompleteAccountTransition
  })

  it('returns false and resets state when a connected client is not authorized', async () => {
    const disconnectListener = vi.fn()
    const unsubscribe = telegramService.onConnectionStateChange(disconnectListener)

    service.client = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      isUserAuthorized: vi.fn().mockResolvedValue(false),
      getMe: vi.fn(),
    }

    const isAuthorized = await telegramService.connect('account-1')

    expect(isAuthorized).toBe(false)
    expect(telegramService.connectionState).toBe('disconnected')
    expect(service.currentUser).toBeNull()
    expect(disconnectListener).toHaveBeenCalledWith('connecting')
    expect(disconnectListener).toHaveBeenLastCalledWith('disconnected')

    unsubscribe()
  })

  it('disconnect clears cached state and reports disconnected', async () => {
    const disconnectListener = vi.fn()
    const unsubscribe = telegramService.onConnectionStateChange(disconnectListener)
    const disconnectMock = vi.fn().mockResolvedValue(undefined)

    service.client = {
      disconnect: disconnectMock,
    }
    service.currentUser = {
      id: BigInt(42),
      firstName: 'Auth',
      lastName: undefined,
      username: 'auth_tester',
    }
    service.entityCache.set(BigInt(1), { id: BigInt(1) })
    service._connectionState = 'connected'

    await telegramService.disconnect()

    expect(disconnectMock).toHaveBeenCalledTimes(1)
    expect(service.client).toBeNull()
    expect(service.currentUser).toBeNull()
    expect(service.entityCache.size).toBe(0)
    expect(telegramService.connectionState).toBe('disconnected')
    expect(disconnectListener).toHaveBeenLastCalledWith('disconnected')

    unsubscribe()
  })

  it('blocks new-account requests until the matching session transition completes', async () => {
    const accountsStore = useAccountsStore()
    accountsStore.accounts = [
      {
        id: 'account-b',
        type: 'user',
        label: 'Account B',
        phone: '+10000000002',
        sessionString: 'session-b',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]
    accountsStore.activeAccountId = 'account-b'

    const oldGetDialogs = vi.fn().mockResolvedValue([])
    service.client = {
      connected: true,
      getDialogs: oldGetDialogs,
    }
    service._activeSessionAccountId = 'account-a'

    const transition = telegramService.beginActiveAccountTransition()
    const dialogsPromise = telegramService.getDialogs(10)
    await Promise.resolve()

    expect(oldGetDialogs).not.toHaveBeenCalled()

    const newGetDialogs = vi.fn().mockResolvedValue([])
    service.client = {
      connected: true,
      getDialogs: newGetDialogs,
    }
    service._activeSessionAccountId = 'account-b'
    telegramService.completeActiveAccountTransition(transition)

    await expect(dialogsPromise).resolves.toEqual([])
    expect(oldGetDialogs).not.toHaveBeenCalled()
    expect(newGetDialogs).toHaveBeenCalledWith({ limit: 10 })
  })
})
