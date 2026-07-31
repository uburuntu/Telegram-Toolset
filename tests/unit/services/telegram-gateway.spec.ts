import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatInfo,
  ChatMessage,
  ChatValidationResult,
  ConnectionState,
  DeletedMessage,
  ScheduledMessage,
  UserInfo,
} from '@/types'
import type {
  AccountSecurityInfo,
  AccountStats,
  FullUserInfo,
} from '@/services/telegram/client'
import type { TelegramMessageHandle } from '@/services/telegram/gateway/contracts'
import {
  createTelegramGateway,
  type LegacyTelegramServiceAdapterTarget,
} from '@/services/telegram/gateway/legacy-service-adapter'

const userInfo: UserInfo = {
  id: BigInt(1),
  firstName: 'Alice',
  username: 'alice',
}

const botInfo: UserInfo = {
  id: BigInt(2),
  firstName: 'Build Bot',
  username: 'buildbot',
}

// Production-shaped: `id` is the raw (unsigned) id, `peerId` is its Bot API marked form, and
// `peerRef` carries the entity kind + access hash exactly as getDialogs produces them.
const chatInfo: ChatInfo = {
  id: BigInt('1234567890'),
  peerId: '-1001234567890',
  peerRef: { kind: 'supergroup', rawId: '1234567890', accessHash: '9998887776' },
  title: 'Gateway Chat',
  type: 'supergroup',
  canExport: true,
  canSend: true,
  isAdmin: true,
}

const deletedMessage: DeletedMessage = {
  id: 42,
  chatId: chatInfo.id,
  senderId: userInfo.id,
  text: 'Deleted message',
  date: new Date('2024-01-01T12:00:00Z'),
  hasMedia: false,
}

const scheduledMessage: ScheduledMessage = {
  id: 73,
  chatId: chatInfo.id,
  text: 'Scheduled message',
  date: new Date('2024-01-01T12:05:00Z'),
  scheduledDate: new Date('2024-01-01T13:00:00Z'),
  hasMedia: false,
}

const chatMessage: ChatMessage = {
  id: 99,
  chatId: chatInfo.id,
  chatPeerId: chatInfo.peerId,
  senderId: userInfo.id,
  senderPeerId: '1',
  text: 'History message',
  date: new Date('2024-01-01T12:10:00Z'),
  hasMedia: false,
}

const validationResult: ChatValidationResult = {
  valid: true,
  canExport: true,
  chatType: chatInfo.type,
  chatTitle: chatInfo.title,
}

const fullUserInfo: FullUserInfo = {
  id: userInfo.id,
  firstName: userInfo.firstName,
  username: userInfo.username,
  isPremium: false,
  isVerified: true,
  isRestricted: false,
  commonChatsCount: 7,
  activeUsernames: ['alice_public'],
  hasProfilePhoto: true,
  hasProfileVideo: false,
}

const accountStats: AccountStats = {
  dialogsCount: 12,
  contactsCount: 34,
  blockedCount: 2,
}

const accountSecurityInfo: AccountSecurityInfo = {
  twoStepVerificationEnabled: true,
  recoveryEmailConfigured: true,
  authorizedSessionsCount: 3,
  otherSessionsCount: 2,
  unconfirmedSessionsCount: 0,
  authorizationTtlDays: 180,
  accountTtlDays: 548,
  currentSession: {
    appName: 'Telegram Toolset',
    appVersion: '1.0',
    deviceModel: 'Chrome',
    platform: 'macOS',
    systemVersion: '15',
    location: 'United Kingdom, London',
    createdAt: new Date('2026-01-01T12:00:00Z'),
    lastActiveAt: new Date('2026-01-02T12:00:00Z'),
    officialApp: false,
  },
}

function deletedMessageStream(messages: DeletedMessage[] = [deletedMessage]) {
  return async function* () {
    for (const message of messages) {
      yield message
    }
  }
}

function chatMessageStream(messages: ChatMessage[] = [chatMessage]) {
  return async function* () {
    for (const message of messages) {
      yield message
    }
  }
}

function createLegacyServiceMock(
  overrides: Partial<LegacyTelegramServiceAdapterTarget> = {},
): LegacyTelegramServiceAdapterTarget {
  return {
    isConnected: false,
    user: null,
    connectionState: 'disconnected',
    onConnectionStateChange: vi.fn(() => vi.fn()),
    onFloodWait: vi.fn(() => vi.fn()),
    initClient: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn().mockResolvedValue(true),
    useUserAccountSession: vi.fn().mockResolvedValue(true),
    waitForActiveAccountInit: vi.fn().mockResolvedValue(undefined),
    resetForNewUserLogin: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue(true),
    manualReconnect: vi.fn().mockResolvedValue(true),
    canManualReconnect: vi.fn().mockReturnValue(true),
    startUserAuth: vi.fn().mockResolvedValue(userInfo),
    provideCode: vi.fn().mockReturnValue(true),
    providePassword: vi.fn().mockReturnValue(true),
    abortCurrentUserAuth: vi.fn().mockResolvedValue(undefined),
    startBotAuth: vi.fn().mockResolvedValue(botInfo),
    disconnect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getSessionString: vi.fn().mockReturnValue('session-string'),
    restoreSession: vi.fn(),
    exportSession: vi.fn().mockReturnValue({
      sessionString: 'session-string',
      apiId: 12345,
      apiHash: 'secret',
    }),
    importSession: vi.fn().mockReturnValue(true),
    hasStoredCredentials: vi.fn().mockReturnValue(true),
    getDialogs: vi.fn().mockResolvedValue([chatInfo]),
    canExportFromChat: vi.fn().mockResolvedValue(true),
    validateChatForExport: vi.fn().mockResolvedValue(validationResult),
    iterDeletedMessages: vi.fn(deletedMessageStream()),
    getEntityCached: vi.fn().mockResolvedValue({ id: userInfo.id }),
    clearEntityCache: vi.fn(),
    resolveSenderInfo: vi.fn().mockResolvedValue({
      name: 'Resolved Alice',
      username: userInfo.username,
    }),
    downloadMedia: vi.fn().mockResolvedValue(new Blob(['media'], { type: 'image/jpeg' })),
    downloadMessageMedia: vi
      .fn()
      .mockResolvedValue(new Blob(['message-media'], { type: 'image/jpeg' })),
    getChatMessagesByIds: vi
      .fn()
      .mockResolvedValue(new Map([[chatMessage.id, { id: chatMessage.id }]])),
    canSendToChat: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendFile: vi.fn().mockResolvedValue(undefined),
    forwardMessage: vi.fn().mockResolvedValue(undefined),
    getScheduledMessages: vi.fn().mockResolvedValue([scheduledMessage]),
    deleteScheduledMessages: vi.fn().mockResolvedValue(undefined),
    searchOwnMessages: vi.fn().mockResolvedValue({
      messages: [
        {
          id: chatMessage.id,
          date: chatMessage.date,
          preview: { kind: 'text', text: chatMessage.text! },
        },
      ],
      total: 1,
    }),
    deleteMessages: vi.fn().mockResolvedValue(undefined),
    getExistingMessageIds: vi.fn().mockResolvedValue([chatMessage.id]),
    iterChatMessages: vi.fn(chatMessageStream()),
    getChatMessageCount: vi.fn().mockResolvedValue(128),
    getFullMe: vi.fn().mockResolvedValue(fullUserInfo),
    downloadMyProfilePhoto: vi.fn().mockResolvedValue(new Blob(['photo'], { type: 'image/jpeg' })),
    getAccountStats: vi.fn().mockResolvedValue(accountStats),
    getAccountSecurityInfo: vi.fn().mockResolvedValue(accountSecurityInfo),
    ...overrides,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.doUnmock('@/services/telegram/client')
})

describe('createTelegramGateway', () => {
  it('creates a frozen facade with frozen domains', () => {
    const gateway = createTelegramGateway(createLegacyServiceMock())

    expect(Object.isFrozen(gateway)).toBe(true)
    expect(Object.isFrozen(gateway.auth)).toBe(true)
    expect(Object.isFrozen(gateway.dialogs)).toBe(true)
    expect(Object.isFrozen(gateway.adminLog)).toBe(true)
    expect(Object.isFrozen(gateway.entities)).toBe(true)
    expect(Object.isFrozen(gateway.media)).toBe(true)
    expect(Object.isFrozen(gateway.send)).toBe(true)
    expect(Object.isFrozen(gateway.scheduled)).toBe(true)
    expect(Object.isFrozen(gateway.trace)).toBe(true)
    expect(Object.isFrozen(gateway.account)).toBe(true)
    expect(Object.isFrozen(gateway.history)).toBe(true)
  })

  it('reads live auth state and forwards auth/session calls', async () => {
    const state = {
      isConnected: true,
      user: userInfo,
      connectionState: 'connected' as ConnectionState,
    }

    const service = createLegacyServiceMock()

    Object.defineProperties(service, {
      isConnected: {
        get: () => state.isConnected,
      },
      user: {
        get: () => state.user,
      },
      connectionState: {
        get: () => state.connectionState,
      },
    })

    const gateway = createTelegramGateway(service)
    const connectionListener = vi.fn()
    const unsubscribeConnection = vi.fn()
    vi.mocked(service.onConnectionStateChange).mockReturnValue(unsubscribeConnection)

    expect(gateway.auth.isConnected).toBe(true)
    expect(gateway.auth.user).toEqual(userInfo)
    expect(gateway.auth.connectionState).toBe('connected')

    state.connectionState = 'reconnecting'
    expect(gateway.auth.connectionState).toBe('reconnecting')

    const disconnect = gateway.auth.onConnectionStateChange(connectionListener)
    await gateway.auth.initClient(12345, 'hash')
    const didConnect = await gateway.auth.connect('acct-1')
    await gateway.auth.useUserAccountSession({
      accountId: 'acct-1',
      sessionString: 'session-string',
      apiId: 12345,
      apiHash: 'hash',
    })
    await gateway.auth.waitForActiveAccountInit()
    await gateway.auth.resetForNewUserLogin()
    const didReconnect = await gateway.auth.reconnect()
    const authenticatedUser = await gateway.auth.startUserAuth('+441234567890', {
      onCodeNeeded: vi.fn(),
    })
    gateway.auth.provideCode('12345')
    gateway.auth.providePassword('secret')
    const botUser = await gateway.auth.startBotAuth('bot-token')
    await gateway.auth.abortCurrentUserAuth()
    await gateway.auth.manualReconnect()
    const canReconnect = gateway.auth.canManualReconnect()
    const sessionString = gateway.auth.getSessionString()
    const snapshot = gateway.auth.exportSession()
    const imported = gateway.auth.importSession({
      sessionString: 'imported-session',
      apiId: 54321,
      apiHash: 'imported-secret',
    })
    const hasStoredCredentials = gateway.auth.hasStoredCredentials()
    gateway.auth.restoreSession('restored-session')
    await gateway.auth.disconnect()
    await gateway.auth.logout()
    disconnect()

    expect(service.onConnectionStateChange).toHaveBeenCalledWith(connectionListener)
    expect(service.initClient).toHaveBeenCalledWith(12345, 'hash')
    expect(service.connect).toHaveBeenCalledWith('acct-1')
    expect(service.useUserAccountSession).toHaveBeenCalledWith({
      accountId: 'acct-1',
      sessionString: 'session-string',
      apiId: 12345,
      apiHash: 'hash',
    })
    expect(service.waitForActiveAccountInit).toHaveBeenCalledTimes(1)
    expect(service.resetForNewUserLogin).toHaveBeenCalledTimes(1)
    expect(service.reconnect).toHaveBeenCalledTimes(1)
    expect(service.startUserAuth).toHaveBeenCalledWith('+441234567890', expect.any(Object))
    expect(service.provideCode).toHaveBeenCalledWith('12345')
    expect(service.providePassword).toHaveBeenCalledWith('secret')
    expect(service.startBotAuth).toHaveBeenCalledWith('bot-token')
    expect(service.abortCurrentUserAuth).toHaveBeenCalledTimes(1)
    expect(service.manualReconnect).toHaveBeenCalledTimes(1)
    expect(service.getSessionString).toHaveBeenCalledTimes(1)
    expect(service.importSession).toHaveBeenCalledWith({
      sessionString: 'imported-session',
      apiId: 54321,
      apiHash: 'imported-secret',
    })
    expect(service.hasStoredCredentials).toHaveBeenCalledTimes(1)
    expect(service.restoreSession).toHaveBeenCalledWith('restored-session')
    expect(service.disconnect).toHaveBeenCalledTimes(1)
    expect(service.logout).toHaveBeenCalledTimes(1)
    expect(unsubscribeConnection).toHaveBeenCalledTimes(1)
    expect(didConnect).toBe(true)
    expect(didReconnect).toBe(true)
    expect(snapshot).toEqual({
      sessionString: 'session-string',
      apiId: 12345,
      apiHash: 'secret',
    })
    expect(sessionString).toBe('session-string')
    expect(imported).toBe(true)
    expect(hasStoredCredentials).toBe(true)
    expect(authenticatedUser).toEqual(userInfo)
    expect(botUser).toEqual(botInfo)
  })

  it('forwards discovery, export, entity, and media domains', async () => {
    const service = createLegacyServiceMock()
    const gateway = createTelegramGateway(service)

    const dialogs = await gateway.dialogs.getDialogs(25)
    const validation = await gateway.adminLog.validateChatForExport(chatInfo.id)
    const deletedMessages: DeletedMessage[] = []

    for await (const message of gateway.adminLog.iterDeletedMessages(chatInfo.id, { limit: 1 })) {
      deletedMessages.push(message)
    }

    const entity = await gateway.entities.getEntityCached(userInfo.id)
    const senderInfo = await gateway.entities.resolveSenderInfo(userInfo.id)
    const rawMessages = await gateway.media.getChatMessagesByIds(chatInfo.peerId!, [chatMessage.id])
    const rawMessageHandle = rawMessages.get(chatMessage.id) as TelegramMessageHandle
    const downloadedBlob = await gateway.media.downloadMedia(rawMessageHandle)
    const downloadedMessageBlob = await gateway.media.downloadMessageMedia(deletedMessage)

    expect(dialogs).toEqual([chatInfo])
    expect(validation).toEqual(validationResult)
    expect(deletedMessages).toEqual([deletedMessage])
    expect(entity).toEqual({ id: userInfo.id })
    expect(senderInfo).toEqual({ name: 'Resolved Alice', username: userInfo.username })
    expect(downloadedBlob).toBeInstanceOf(Blob)
    expect(downloadedMessageBlob).toBeInstanceOf(Blob)
    expect(service.getDialogs).toHaveBeenCalledWith(25)
    expect(service.validateChatForExport).toHaveBeenCalledWith(chatInfo.id)
    expect(service.iterDeletedMessages).toHaveBeenCalledWith(chatInfo.id, { limit: 1 })
    expect(service.getEntityCached).toHaveBeenCalledWith(userInfo.id)
    expect(service.resolveSenderInfo).toHaveBeenCalledWith(userInfo.id)
    expect(service.getChatMessagesByIds).toHaveBeenCalledWith(chatInfo.peerId, [chatMessage.id])
    expect(service.downloadMedia).toHaveBeenCalledWith(rawMessageHandle)
    expect(service.downloadMessageMedia).toHaveBeenCalledWith(deletedMessage)
  })

  it('forwards send, scheduled, account, and history domains', async () => {
    const service = createLegacyServiceMock()
    const gateway = createTelegramGateway(service)
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })

    await gateway.send.canSendToChat(chatInfo.id)
    await gateway.send.sendMessage(chatInfo.id, 'hello', 'html')
    await gateway.send.sendFile(chatInfo.id, file, {
      caption: 'attachment',
      filename: 'hello.txt',
    })
    await gateway.send.forwardMessage(chatInfo.id, chatInfo.id, 7)
    const scheduledMessages = await gateway.scheduled.getScheduledMessages(chatInfo.id)
    await gateway.scheduled.deleteScheduledMessages(chatInfo.id, [scheduledMessage.id])
    const ownMessages = await gateway.trace.searchOwnMessages(chatInfo.id, { offsetId: 100 })
    await gateway.trace.deleteMessages(chatInfo.id, [chatMessage.id])
    const existingIds = await gateway.trace.getExistingMessageIds(chatInfo.id, [chatMessage.id])
    const fullMe = await gateway.account.getFullMe()
    const stats = await gateway.account.getAccountStats()
    const securityInfo = await gateway.account.getAccountSecurityInfo()
    const profilePhoto = await gateway.account.downloadMyProfilePhoto()
    const historyMessages: ChatMessage[] = []

    for await (const message of gateway.history.iterChatMessages(chatInfo.peerId!, { limit: 1 })) {
      historyMessages.push(message)
    }

    const historyCount = await gateway.history.getChatMessageCount(chatInfo.peerId!)
    // The history count also accepts a canonical PeerRef and forwards it unchanged.
    await gateway.history.getChatMessageCount(chatInfo.peerRef!)

    expect(scheduledMessages).toEqual([scheduledMessage])
    expect(ownMessages.messages).toEqual([
      {
        id: chatMessage.id,
        date: chatMessage.date,
        preview: { kind: 'text', text: chatMessage.text },
      },
    ])
    expect(existingIds).toEqual([chatMessage.id])
    expect(fullMe).toEqual(fullUserInfo)
    expect(stats).toEqual(accountStats)
    expect(securityInfo).toEqual(accountSecurityInfo)
    expect(profilePhoto).toBeInstanceOf(Blob)
    expect(historyMessages).toEqual([chatMessage])
    expect(historyCount).toBe(128)
    expect(service.canSendToChat).toHaveBeenCalledWith(chatInfo.id)
    expect(service.sendMessage).toHaveBeenCalledWith(chatInfo.id, 'hello', 'html')
    expect(service.sendFile).toHaveBeenCalledWith(chatInfo.id, file, {
      caption: 'attachment',
      filename: 'hello.txt',
    })
    expect(service.forwardMessage).toHaveBeenCalledWith(chatInfo.id, chatInfo.id, 7)
    expect(service.getScheduledMessages).toHaveBeenCalledWith(chatInfo.id)
    expect(service.deleteScheduledMessages).toHaveBeenCalledWith(chatInfo.id, [scheduledMessage.id])
    expect(service.searchOwnMessages).toHaveBeenCalledWith(chatInfo.id, { offsetId: 100 })
    expect(service.deleteMessages).toHaveBeenCalledWith(chatInfo.id, [chatMessage.id])
    expect(service.getExistingMessageIds).toHaveBeenCalledWith(chatInfo.id, [chatMessage.id])
    expect(service.getFullMe).toHaveBeenCalledTimes(1)
    expect(service.getAccountStats).toHaveBeenCalledTimes(1)
    expect(service.getAccountSecurityInfo).toHaveBeenCalledTimes(1)
    expect(service.downloadMyProfilePhoto).toHaveBeenCalledTimes(1)
    expect(service.iterChatMessages).toHaveBeenCalledWith(chatInfo.peerId, { limit: 1 })
    expect(service.getChatMessageCount).toHaveBeenCalledWith(chatInfo.peerId)
    expect(service.getChatMessageCount).toHaveBeenCalledWith(chatInfo.peerRef)
  })
})

describe('telegram gateway facade exports', () => {
  it('builds singleton-backed domain shortcuts from the current service module', async () => {
    const service = createLegacyServiceMock()

    vi.doMock('@/services/telegram/client', () => ({
      telegramService: service,
    }))

    const gatewayModule = await import('@/services/telegram/gateway')

    expect(gatewayModule.telegramGateway.auth).toBe(gatewayModule.telegramAuthGateway)
    expect(gatewayModule.telegramGateway.dialogs).toBe(gatewayModule.telegramDialogsGateway)
    expect(gatewayModule.telegramGateway.history).toBe(gatewayModule.telegramHistoryGateway)

    await gatewayModule.telegramDialogsGateway.getDialogs(10)
    await gatewayModule.telegramAccountGateway.getAccountStats()
    await gatewayModule.telegramAccountGateway.getAccountSecurityInfo()

    expect(service.getDialogs).toHaveBeenCalledWith(10)
    expect(service.getAccountStats).toHaveBeenCalledTimes(1)
    expect(service.getAccountSecurityInfo).toHaveBeenCalledTimes(1)
  })
})
