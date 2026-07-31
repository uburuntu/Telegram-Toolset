import { Long, tl } from '@mtcute/web'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mtcuteMethods = vi.hoisted(() => ({
  checkPassword: vi.fn(),
  deleteMessagesById: vi.fn(),
  deleteScheduledMessages: vi.fn(),
  downloadAsBuffer: vi.fn(),
  forwardMessagesById: vi.fn(),
  getAllScheduledMessages: vi.fn(),
  getChat: vi.fn(),
  getChatEventLog: vi.fn(),
  getFullUser: vi.fn(),
  getHistory: vi.fn(),
  getMe: vi.fn(),
  getMessages: vi.fn(),
  getPasswordHint: vi.fn(),
  getUsers: vi.fn(),
  iterDialogs: vi.fn(),
  iterHistory: vi.fn(),
  logOut: vi.fn(),
  resolvePeer: vi.fn(),
  searchMessages: vi.fn(),
  sendCode: vi.fn(),
  sendMedia: vi.fn(),
  sendText: vi.fn(),
  signIn: vi.fn(),
  signInBot: vi.fn(),
}))

vi.mock('@mtcute/web/methods.js', () => mtcuteMethods)

import { TelegramService } from '@/services/telegram/client'
import { useAccountsStore } from '@/stores'

const userPeer = {
  type: 'user',
  id: 7,
  raw: { _: 'user', id: Long.fromNumber(7), accessHash: Long.fromNumber(70) },
  firstName: 'Alice',
  lastName: 'Example',
  displayName: 'Alice Example',
  username: 'alice',
  phoneNumber: null,
}

const groupPeer = {
  type: 'chat',
  id: -99,
  raw: { _: 'chat', id: Long.fromNumber(99), title: 'Group' },
  chatType: 'group',
  displayName: 'Group',
  title: 'Group',
  username: null,
  membersCount: 3,
  isAdmin: false,
  isCreator: false,
  permissions: null,
}

function emptyAsyncIterable() {
  return (async function* () {})()
}

describe('TelegramService connection state', () => {
  let service: TelegramService & Record<string, any>

  function installActiveUserAccount(accountId = 'account-a'): void {
    const accountsStore = useAccountsStore()
    accountsStore.accounts = [
      {
        id: accountId,
        type: 'user',
        label: 'Account A',
        sessionString: 'session-a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]
    accountsStore.activeAccountId = accountId
    service._activeSessionAccountId = accountId
  }

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setActivePinia(createPinia())
    service = new TelegramService() as TelegramService & Record<string, any>
    mtcuteMethods.iterDialogs.mockImplementation(() => emptyAsyncIterable())
  })

  it('returns false and resets state when a connected client is not authorized', async () => {
    const stateListener = vi.fn()
    service.onConnectionStateChange(stateListener)
    service.client = {
      connect: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    }
    mtcuteMethods.getMe.mockRejectedValue(
      new tl.RpcError(tl.RpcError.UNAUTHORIZED, 'AUTH_KEY_UNREGISTERED'),
    )

    await expect(service.connect('account-1')).resolves.toBe(false)
    expect(service.connectionState).toBe('disconnected')
    expect(service.user).toBeNull()
    expect(stateListener).toHaveBeenNthCalledWith(1, 'connecting')
    expect(stateListener).toHaveBeenLastCalledWith('disconnected')
  })

  it('releases the client and reports error when connect throws', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined)
    service.client = {
      connect: vi.fn().mockRejectedValue(new Error('network down')),
      destroy,
    }
    service.currentUser = { id: BigInt(7), firstName: 'Stale' }
    service.entityCache.set('1', userPeer)
    service._activeSessionAccountId = 'account-1'

    await expect(service.connect('account-1')).rejects.toThrow('network down')
    expect(destroy).toHaveBeenCalledOnce()
    expect(service.client).toBeNull()
    expect(service.user).toBeNull()
    expect(service.entityCache.size).toBe(0)
    expect(service._activeSessionAccountId).toBeNull()
    expect(service.connectionState).toBe('error')
  })

  it('disconnect destroys the mtcute client and clears cached state', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined)
    service.client = { destroy }
    service.currentUser = { id: BigInt(42), firstName: 'Auth' }
    service.entityCache.set('1', userPeer)
    service._connectionState = 'connected'

    await service.disconnect()

    expect(destroy).toHaveBeenCalledOnce()
    expect(service.client).toBeNull()
    expect(service.user).toBeNull()
    expect(service.entityCache.size).toBe(0)
    expect(service.connectionState).toBe('disconnected')
  })

  it('blocks requests until the matching account transition completes', async () => {
    installActiveUserAccount('account-b')
    const oldClient = { isConnected: true }
    const newClient = { isConnected: true }
    service.client = oldClient
    service._activeSessionAccountId = 'account-a'

    const transition = service.beginActiveAccountTransition()
    const dialogsPromise = service.getDialogs(10)
    await Promise.resolve()
    expect(mtcuteMethods.iterDialogs).not.toHaveBeenCalled()

    service.client = newClient
    service._activeSessionAccountId = 'account-b'
    service.completeActiveAccountTransition(transition)

    await expect(dialogsPromise).resolves.toEqual([])
    expect(mtcuteMethods.iterDialogs).toHaveBeenCalledWith(newClient, {
      limit: 10,
      archived: 'keep',
      pinned: 'keep',
    })
  })

  it('clears session ownership when aborting authentication', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined)
    service.client = { destroy }
    service._activeSessionAccountId = 'account-a'

    await service.abortCurrentUserAuth()

    expect(destroy).toHaveBeenCalledOnce()
    expect(service.client).toBeNull()
    expect(service._activeSessionAccountId).toBeNull()
  })

  it('records session ownership for a freshly authenticated login', () => {
    service.markActiveUserSession('account-b')
    expect(service._activeSessionAccountId).toBe('account-b')

    service.markActiveUserSession('')
    expect(service._activeSessionAccountId).toBe('account-b')
  })

  it('keeps a connected client that already belongs to the account', async () => {
    installActiveUserAccount('account-b')
    const client = { isConnected: true }
    service.client = client
    const initSpy = vi.spyOn(service, 'initClient')

    await expect(
      service.useUserAccountSession({
        accountId: 'account-b',
        sessionString: 'session-b',
        apiId: 123,
        apiHash: 'hash',
      }),
    ).resolves.toBe(true)

    expect(initSpy).not.toHaveBeenCalled()
    expect(service.client).toBe(client)
  })

  it('rebuilds the runtime when switching accounts', async () => {
    service.client = { isConnected: true }
    service._activeSessionAccountId = 'account-a'
    const disconnectSpy = vi.spyOn(service, 'disconnect').mockResolvedValue(undefined)
    const initSpy = vi.spyOn(service, 'initClient').mockResolvedValue(undefined)
    const connectSpy = vi.spyOn(service, 'connect').mockResolvedValue(true)
    vi.spyOn(service, 'setAccountSessionState').mockResolvedValue(undefined)

    await expect(
      service.useUserAccountSession({
        accountId: 'account-b',
        sessionString: 'session-b',
        apiId: 123,
        apiHash: 'hash',
      }),
    ).resolves.toBe(true)

    expect(disconnectSpy).toHaveBeenCalledOnce()
    expect(initSpy).toHaveBeenCalledWith(123, 'hash')
    expect(connectSpy).toHaveBeenCalledWith('account-b')
    expect(service.sessionString).toBe('session-b')
  })

  it('maps extended account profile metadata from mtcute', async () => {
    installActiveUserAccount()
    service.client = { isConnected: true }
    mtcuteMethods.getFullUser.mockResolvedValue({
      ...userPeer,
      bio: 'Account bio',
      isPremium: true,
      isVerified: false,
      isRestricted: false,
      restrictionReason: [],
      commonChatsCount: 12,
      usernames: [
        { active: true, username: 'alice' },
        { active: true, username: 'alice_work' },
      ],
      language: 'en',
      birthday: { day: 14, month: 2, year: 1990 },
      photo: { raw: { hasVideo: true } },
      dcId: 4,
      phoneNumber: '+44123',
    })

    await expect(service.getFullMe()).resolves.toMatchObject({
      id: BigInt(7),
      firstName: 'Alice',
      lastName: 'Example',
      username: 'alice',
      bio: 'Account bio',
      activeUsernames: ['alice_work'],
      languageCode: 'en',
      birthday: { day: 14, month: 2, year: 1990 },
      commonChatsCount: 12,
      hasProfilePhoto: true,
      hasProfileVideo: true,
      dcId: 4,
    })
    expect(mtcuteMethods.getFullUser).toHaveBeenCalledWith(service.client, 'self')
  })

  it('returns a privacy-minimized security and session summary', async () => {
    installActiveUserAccount()
    service.client = {
      isConnected: true,
      call: vi.fn(async (request: { _: string }) => {
        if (request._ === 'account.getAuthorizations') {
          return {
            authorizationTtlDays: 180,
            authorizations: [
              {
                current: true,
                officialApp: false,
                unconfirmed: false,
                appName: 'Telegram Toolset',
                appVersion: '1.0',
                deviceModel: 'Chrome',
                platform: 'macOS',
                systemVersion: '15',
                country: 'United Kingdom',
                region: 'London',
                dateCreated: 1_767_268_800,
                dateActive: 1_767_355_200,
              },
              { current: false, unconfirmed: true },
            ],
          }
        }
        if (request._ === 'account.getAccountTTL') return { days: 548 }
        if (request._ === 'account.getPassword') return { hasPassword: true, hasRecovery: true }
        throw new Error('Unexpected request')
      }),
    }

    const security = await service.getAccountSecurityInfo()

    expect(security).toMatchObject({
      twoStepVerificationEnabled: true,
      recoveryEmailConfigured: true,
      authorizedSessionsCount: 2,
      otherSessionsCount: 1,
      unconfirmedSessionsCount: 1,
      authorizationTtlDays: 180,
      accountTtlDays: 548,
      currentSession: {
        appName: 'Telegram Toolset',
        location: 'United Kingdom, London',
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
        lastActiveAt: new Date('2026-01-02T12:00:00.000Z'),
      },
    })
    expect(security?.currentSession).not.toHaveProperty('ip')
  })

  it('searches only the active user messages with a resumable cursor', async () => {
    installActiveUserAccount()
    service.client = { isConnected: true }
    service.entityCache.set('99', groupPeer)
    const result = Object.assign(
      [
        { id: 20, date: new Date('2024-01-01T12:00:00.000Z'), text: 'mine' },
        { id: 10, date: new Date('2023-01-01T00:00:00.000Z'), text: '' },
      ],
      { total: 5, next: 10 },
    )
    mtcuteMethods.searchMessages.mockResolvedValue(result)

    await expect(
      service.searchOwnMessages(BigInt(99), {
        offsetId: 30,
        minDate: new Date('2023-01-01T00:00:00.000Z'),
        maxDate: new Date('2024-12-31T23:59:59.999Z'),
        limit: 2,
      }),
    ).resolves.toEqual({
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
    expect(mtcuteMethods.searchMessages).toHaveBeenCalledWith(
      service.client,
      expect.objectContaining({ chatId: groupPeer, fromUser: 'self', offset: 30, limit: 2 }),
    )
  })

  it('revokes bounded message batches and reconciles remaining IDs', async () => {
    installActiveUserAccount()
    service.client = { isConnected: true }
    service.entityCache.set('99', groupPeer)
    mtcuteMethods.deleteMessagesById.mockResolvedValue(undefined)
    mtcuteMethods.getMessages.mockResolvedValue([
      null,
      { id: 2, chat: groupPeer, sender: userPeer },
    ])

    await service.deleteMessages(BigInt(99), [1, 2])
    await expect(service.getExistingMessageIds(BigInt(99), [1, 2])).resolves.toEqual([2])

    expect(mtcuteMethods.deleteMessagesById).toHaveBeenCalledWith(
      service.client,
      groupPeer,
      [1, 2],
      { revoke: true },
    )
  })
})
