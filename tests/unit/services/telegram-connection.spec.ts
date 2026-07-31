import { createPinia, setActivePinia } from 'pinia'
import { Api } from 'telegram'
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

  function installActiveUserAccount(): void {
    const accountsStore = useAccountsStore()
    accountsStore.accounts = [
      {
        id: 'account-a',
        type: 'user',
        label: 'Account A',
        sessionString: 'session-a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]
    accountsStore.activeAccountId = 'account-a'
    service._activeSessionAccountId = 'account-a'
  }

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

  it('releases the client and reports error when connect throws', async () => {
    const stateListener = vi.fn()
    const unsubscribe = telegramService.onConnectionStateChange(stateListener)

    const disconnectMock = vi.fn().mockResolvedValue(undefined)
    service.client = {
      connect: vi.fn().mockRejectedValue(new Error('network down')),
      disconnect: disconnectMock,
      isUserAuthorized: vi.fn(),
      getMe: vi.fn(),
    }
    service.currentUser = { id: BigInt(7), firstName: 'Stale', lastName: undefined }
    service.entityCache.set(BigInt(1), { id: BigInt(1) })
    service._activeSessionAccountId = 'account-1'

    await expect(telegramService.connect('account-1')).rejects.toThrow('network down')

    // A failed connect must not linger as a half-open connection, but the typed state stays honest.
    expect(disconnectMock).toHaveBeenCalledTimes(1)
    expect(service.client).toBeNull()
    expect(service.currentUser).toBeNull()
    expect(service.entityCache.size).toBe(0)
    expect(service._activeSessionAccountId).toBeNull()
    expect(telegramService.connectionState).toBe('error')
    expect(stateListener).toHaveBeenLastCalledWith('error')

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

  it('clears session ownership when aborting an auth attempt tears down the client', async () => {
    service.client = {
      disconnect: vi.fn().mockResolvedValue(undefined),
    }
    service._activeSessionAccountId = 'account-a'

    await telegramService.abortCurrentUserAuth()

    expect(service.client).toBeNull()
    expect(service._activeSessionAccountId).toBeNull()
  })

  it('records session ownership for a freshly authenticated login', () => {
    service._activeSessionAccountId = null

    telegramService.markActiveUserSession('account-b')
    expect(service._activeSessionAccountId).toBe('account-b')

    // A blank id must never clobber established ownership.
    telegramService.markActiveUserSession('')
    expect(service._activeSessionAccountId).toBe('account-b')
  })

  it('keeps a just-authenticated client instead of rebuilding it for the same account', async () => {
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
    const markReady = vi.spyOn(accountsStore, 'markAccountSessionReady')

    const client = { connected: true, disconnect: vi.fn().mockResolvedValue(undefined) }
    service.client = client
    service._activeSessionAccountId = 'account-b'
    const initSpy = vi.spyOn(service, 'initClient')

    const result = await telegramService.useUserAccountSession({
      accountId: 'account-b',
      sessionString: 'session-b',
      apiId: 123,
      apiHash: 'hash',
    })

    expect(result).toBe(true)
    expect(client.disconnect).not.toHaveBeenCalled()
    expect(initSpy).not.toHaveBeenCalled()
    expect(service.client).toBe(client)
    expect(markReady).toHaveBeenCalledWith('account-b')

    initSpy.mockRestore()
  })

  it('rebuilds the session when the connected client belongs to another account', async () => {
    service.client = { connected: true, disconnect: vi.fn().mockResolvedValue(undefined) }
    service._activeSessionAccountId = 'account-a'

    const disconnectSpy = vi.spyOn(service, 'disconnect').mockResolvedValue(undefined)
    const initSpy = vi.spyOn(service, 'initClient').mockResolvedValue(undefined)
    const connectSpy = vi.spyOn(service, 'connect').mockResolvedValue(true)
    const stateSpy = vi.spyOn(service, 'setAccountSessionState').mockResolvedValue(undefined)

    const result = await telegramService.useUserAccountSession({
      accountId: 'account-b',
      sessionString: '',
      apiId: 123,
      apiHash: 'hash',
    })

    expect(result).toBe(true)
    expect(disconnectSpy).toHaveBeenCalledTimes(1)
    expect(initSpy).toHaveBeenCalledWith(123, 'hash')
    expect(connectSpy).toHaveBeenCalledWith('account-b')

    disconnectSpy.mockRestore()
    initSpy.mockRestore()
    connectSpy.mockRestore()
    stateSpy.mockRestore()
  })

  it('searches only the active user messages with a resumable server-side cursor', async () => {
    installActiveUserAccount()
    const entity = { id: BigInt(99) }
    const inputPeer = new Api.InputPeerChat({ chatId: BigInt(99) as unknown as Api.long })
    const self = new Api.InputPeerSelf()
    const first = new Api.Message({
      id: 20,
      peerId: new Api.PeerChat({ chatId: BigInt(99) as unknown as Api.long }),
      date: 1_704_110_400,
      message: 'mine',
    })
    const second = new Api.Message({
      id: 10,
      peerId: new Api.PeerChat({ chatId: BigInt(99) as unknown as Api.long }),
      date: 1_672_531_200,
      message: '',
    })
    const invoke = vi.fn().mockResolvedValue(
      new Api.messages.MessagesSlice({
        count: 5,
        messages: [first, second],
        chats: [],
        users: [],
      }),
    )
    service.client = {
      connected: true,
      getEntity: vi.fn().mockResolvedValue(entity),
      getInputEntity: vi.fn(async (value: unknown) => (value === 'me' ? self : inputPeer)),
      invoke,
    }

    const page = await telegramService.searchOwnMessages(BigInt(99), {
      offsetId: 30,
      minDate: new Date('2023-01-01T00:00:00.000Z'),
      maxDate: new Date('2024-12-31T23:59:59.999Z'),
      limit: 2,
    })

    expect(page).toEqual({
      messages: [
        {
          id: 20,
          date: new Date('2024-01-01T12:00:00.000Z'),
          preview: { kind: 'text', text: 'mine' },
        },
        {
          id: 10,
          date: new Date('2023-01-01T00:00:00.000Z'),
          preview: { kind: 'non_text' },
        },
      ],
      total: 5,
      nextOffsetId: 10,
    })
    const request = invoke.mock.calls[0]?.[0]
    expect(request).toBeInstanceOf(Api.messages.Search)
    expect(request).toMatchObject({
      peer: inputPeer,
      fromId: self,
      offsetId: 30,
      limit: 2,
    })
  })

  it('revokes bounded message batches and can reconcile the remaining IDs', async () => {
    installActiveUserAccount()
    const entity = { id: BigInt(99) }
    const rawMessage = new Api.Message({
      id: 2,
      peerId: new Api.PeerChat({ chatId: BigInt(99) as unknown as Api.long }),
      date: 1_704_110_400,
      message: 'still here',
    })
    const deleteMessages = vi.fn().mockResolvedValue([])
    const getMessages = vi.fn().mockResolvedValue([undefined, rawMessage])
    service.client = {
      connected: true,
      getEntity: vi.fn().mockResolvedValue(entity),
      deleteMessages,
      getMessages,
    }

    await telegramService.deleteMessages(BigInt(99), [1, 2])
    const existing = await telegramService.getExistingMessageIds(BigInt(99), [1, 2])

    expect(deleteMessages).toHaveBeenCalledWith(entity, [1, 2], { revoke: true })
    expect(getMessages).toHaveBeenCalledWith(entity, { ids: [1, 2] })
    expect(existing).toEqual([2])
  })
})
