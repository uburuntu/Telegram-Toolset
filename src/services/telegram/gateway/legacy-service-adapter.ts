import type {
  AdminLogIterOptions,
  ChatHistoryOptions,
  ChatInfo,
  ChatValidationResult,
  ConnectionState,
  DeletedMessage,
  OwnMessageSearchOptions,
  OwnMessageSearchPage,
  PeerRef,
  ScheduledMessage,
  UserInfo,
} from '@/types'
import type { AccountStats, FullUserInfo } from '../client'
import type {
  TelegramAccountGateway,
  TelegramAdminLogGateway,
  TelegramAuthSessionGateway,
  TelegramChatMessageStream,
  TelegramDeletedMessageStream,
  TelegramDialogsGateway,
  TelegramEntitiesGateway,
  TelegramEntityHandle,
  TelegramGateway,
  TelegramHistoryGateway,
  TelegramMediaGateway,
  TelegramMessageHandle,
  TelegramPeerRef,
  TelegramScheduledGateway,
  TelegramSenderInfo,
  TelegramSendFileOptions,
  TelegramSendGateway,
  TelegramSessionSnapshot,
  TelegramTraceGateway,
  TelegramUserAccountSessionInput,
  TelegramUserAuthOptions,
} from './contracts'

export interface LegacyTelegramServiceAdapterTarget {
  readonly isConnected: boolean
  readonly user: UserInfo | null
  readonly connectionState: ConnectionState
  onConnectionStateChange(listener: (state: ConnectionState) => void): () => void
  onFloodWait(listener: (seconds: number, method: string) => void): () => void
  initClient(apiId: number, apiHash: string): Promise<void>
  connect(accountId?: string): Promise<boolean>
  useUserAccountSession(data: TelegramUserAccountSessionInput): Promise<boolean>
  waitForActiveAccountInit(): Promise<void>
  resetForNewUserLogin(): Promise<void>
  reconnect(): Promise<boolean>
  manualReconnect(): Promise<boolean>
  canManualReconnect(): boolean
  startUserAuth(phone: string, options?: TelegramUserAuthOptions): Promise<UserInfo>
  provideCode(code: string): boolean
  providePassword(password: string): boolean
  abortCurrentUserAuth(): Promise<void>
  startBotAuth(botToken: string): Promise<UserInfo>
  disconnect(): Promise<void>
  logout(): Promise<void>
  getSessionString(): string
  restoreSession(sessionString: string): void
  exportSession(): TelegramSessionSnapshot | null
  importSession(data: TelegramSessionSnapshot): boolean
  hasStoredCredentials(): boolean
  getDialogs(limit?: number): Promise<ChatInfo[]>
  canExportFromChat(chatId: bigint): Promise<boolean>
  validateChatForExport(chatId: bigint): Promise<ChatValidationResult>
  iterDeletedMessages(chatId: bigint, options?: AdminLogIterOptions): TelegramDeletedMessageStream
  getEntityCached(entityId: TelegramPeerRef): Promise<unknown>
  clearEntityCache(): void
  resolveSenderInfo(senderId: TelegramPeerRef): Promise<TelegramSenderInfo>
  downloadMedia(messageOrHandle: DeletedMessage | unknown): Promise<Blob | null>
  downloadMessageMedia(message: DeletedMessage): Promise<Blob | null>
  getChatMessagesByIds(chatId: TelegramPeerRef, messageIds: number[]): Promise<Map<number, unknown>>
  canSendToChat(chatId: bigint): Promise<boolean>
  sendMessage(chatId: bigint, text: string, parseMode?: 'html' | 'md'): Promise<void>
  sendFile(chatId: bigint, file: Blob | File, options?: TelegramSendFileOptions): Promise<void>
  forwardMessage(fromChatId: bigint, toChatId: bigint, messageId: number): Promise<void>
  getScheduledMessages(chatId: bigint): Promise<ScheduledMessage[]>
  deleteScheduledMessages(chatId: bigint, messageIds: number[]): Promise<void>
  searchOwnMessages(
    chatId: TelegramPeerRef,
    options?: OwnMessageSearchOptions,
  ): Promise<OwnMessageSearchPage>
  deleteMessages(chatId: TelegramPeerRef, messageIds: number[]): Promise<void>
  getExistingMessageIds(chatId: TelegramPeerRef, messageIds: number[]): Promise<number[]>
  iterChatMessages(chatId: TelegramPeerRef, options?: ChatHistoryOptions): TelegramChatMessageStream
  getChatMessageCount(chatId: TelegramPeerRef | PeerRef): Promise<number>
  getFullMe(): Promise<FullUserInfo | null>
  downloadMyProfilePhoto(): Promise<Blob | null>
  getAccountStats(): Promise<AccountStats>
}

export function createTelegramGateway(
  service: LegacyTelegramServiceAdapterTarget,
): TelegramGateway {
  const auth: TelegramAuthSessionGateway = {
    get isConnected() {
      return service.isConnected
    },
    get user() {
      return service.user
    },
    get connectionState() {
      return service.connectionState
    },
    onConnectionStateChange: (listener) => service.onConnectionStateChange(listener),
    onFloodWait: (listener) => service.onFloodWait(listener),
    initClient: (apiId, apiHash) => service.initClient(apiId, apiHash),
    connect: (accountId) => service.connect(accountId),
    useUserAccountSession: (data) => service.useUserAccountSession(data),
    waitForActiveAccountInit: () => service.waitForActiveAccountInit(),
    resetForNewUserLogin: () => service.resetForNewUserLogin(),
    reconnect: () => service.reconnect(),
    manualReconnect: () => service.manualReconnect(),
    canManualReconnect: () => service.canManualReconnect(),
    startUserAuth: (phone, options) => service.startUserAuth(phone, options),
    provideCode: (code) => service.provideCode(code),
    providePassword: (password) => service.providePassword(password),
    abortCurrentUserAuth: () => service.abortCurrentUserAuth(),
    startBotAuth: (botToken) => service.startBotAuth(botToken),
    disconnect: () => service.disconnect(),
    logout: () => service.logout(),
    getSessionString: () => service.getSessionString(),
    restoreSession: (sessionString) => service.restoreSession(sessionString),
    exportSession: () => service.exportSession(),
    importSession: (data) => service.importSession(data),
    hasStoredCredentials: () => service.hasStoredCredentials(),
  }

  const dialogs: TelegramDialogsGateway = {
    getDialogs: (limit) => service.getDialogs(limit),
  }

  const adminLog: TelegramAdminLogGateway = {
    canExportFromChat: (chatId) => service.canExportFromChat(chatId),
    validateChatForExport: (chatId) => service.validateChatForExport(chatId),
    iterDeletedMessages: (chatId, options) => service.iterDeletedMessages(chatId, options),
  }

  const entities: TelegramEntitiesGateway = {
    getEntityCached: async (entityId) =>
      (await service.getEntityCached(entityId)) as TelegramEntityHandle | undefined,
    clearEntityCache: () => service.clearEntityCache(),
    resolveSenderInfo: (senderId) => service.resolveSenderInfo(senderId),
  }

  const media: TelegramMediaGateway = {
    downloadMedia: (messageOrHandle) => service.downloadMedia(messageOrHandle as unknown),
    downloadMessageMedia: (message) => service.downloadMessageMedia(message),
    getChatMessagesByIds: async (chatId, messageIds) =>
      (await service.getChatMessagesByIds(chatId, messageIds)) as Map<
        number,
        TelegramMessageHandle
      >,
  }

  const send: TelegramSendGateway = {
    canSendToChat: (chatId) => service.canSendToChat(chatId),
    sendMessage: (chatId, text, parseMode) => service.sendMessage(chatId, text, parseMode),
    sendFile: (chatId, file, options) => service.sendFile(chatId, file, options),
    forwardMessage: (fromChatId, toChatId, messageId) =>
      service.forwardMessage(fromChatId, toChatId, messageId),
  }

  const scheduled: TelegramScheduledGateway = {
    getScheduledMessages: (chatId) => service.getScheduledMessages(chatId),
    deleteScheduledMessages: (chatId, messageIds) =>
      service.deleteScheduledMessages(chatId, messageIds),
  }

  const trace: TelegramTraceGateway = {
    searchOwnMessages: (chatId, options) => service.searchOwnMessages(chatId, options),
    deleteMessages: (chatId, messageIds) => service.deleteMessages(chatId, messageIds),
    getExistingMessageIds: (chatId, messageIds) =>
      service.getExistingMessageIds(chatId, messageIds),
  }

  const account: TelegramAccountGateway = {
    getFullMe: () => service.getFullMe(),
    downloadMyProfilePhoto: () => service.downloadMyProfilePhoto(),
    getAccountStats: () => service.getAccountStats(),
  }

  const history: TelegramHistoryGateway = {
    iterChatMessages: (chatId, options) => service.iterChatMessages(chatId, options),
    getChatMessageCount: (chatId) => service.getChatMessageCount(chatId),
  }

  return Object.freeze({
    auth: Object.freeze(auth),
    dialogs: Object.freeze(dialogs),
    adminLog: Object.freeze(adminLog),
    entities: Object.freeze(entities),
    media: Object.freeze(media),
    send: Object.freeze(send),
    scheduled: Object.freeze(scheduled),
    trace: Object.freeze(trace),
    account: Object.freeze(account),
    history: Object.freeze(history),
  })
}
