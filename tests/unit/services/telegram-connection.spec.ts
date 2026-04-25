import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { telegramService } from '@/services/telegram/client'

describe('telegramService connection state', () => {
  const service = telegramService as any
  const originalClient = service.client
  const originalCurrentUser = service.currentUser
  const originalConnectionState = service._connectionState
  const originalEntityCache = service.entityCache
  const originalReconnectAttempts = service.reconnectAttempts

  beforeEach(() => {
    vi.clearAllMocks()
    service.client = null
    service.currentUser = null
    service._connectionState = 'disconnected'
    service.entityCache = new Map()
    service.reconnectAttempts = 0
  })

  afterEach(() => {
    service.client = originalClient
    service.currentUser = originalCurrentUser
    service._connectionState = originalConnectionState
    service.entityCache = originalEntityCache
    service.reconnectAttempts = originalReconnectAttempts
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
})
