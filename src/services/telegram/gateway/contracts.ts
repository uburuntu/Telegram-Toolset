import type {
  AdminLogIterOptions,
  ChatHistoryOptions,
  ChatInfo,
  ChatMessage,
  ChatValidationResult,
  ConnectionState,
  DeletedMessage,
  OwnMessageSearchOptions,
  OwnMessageSearchPage,
  PeerRef,
  ScheduledMessage,
  UserInfo,
} from '@/types'
import type { AccountSecurityInfo, AccountStats, FullUserInfo } from '../client'

export type TelegramPeerRef = bigint | string

declare const telegramEntityHandleBrand: unique symbol
declare const telegramMessageHandleBrand: unique symbol

// Opaque handles keep mtcute runtime objects behind the gateway boundary.
export type TelegramEntityHandle = {
  readonly [telegramEntityHandleBrand]: true
}

export type TelegramMessageHandle = {
  readonly [telegramMessageHandleBrand]: true
}

export type RecoverableAuthStage = 'code' | 'password'

export interface TelegramUserAuthOptions {
  onCodeNeeded?: () => void
  onPasswordNeeded?: (hint?: string) => void
  onRecoverableError?: (error: unknown, stage: RecoverableAuthStage) => void
}

export interface TelegramSessionSnapshot {
  sessionString: string
  apiId?: number
  apiHash?: string
}

export interface TelegramUserAccountSessionInput extends TelegramSessionSnapshot {
  accountId?: string
}

export interface TelegramSenderInfo {
  name?: string
  username?: string
}

export interface TelegramSendFileOptions {
  caption?: string
  parseMode?: 'html'
  forceDocument?: boolean
  filename?: string
}

export type TelegramDeletedMessageStream = AsyncIterable<DeletedMessage>
export type TelegramChatMessageStream = AsyncIterable<ChatMessage>

export interface TelegramAuthSessionGateway {
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
}

export interface TelegramDialogsGateway {
  getDialogs(limit?: number): Promise<ChatInfo[]>
}

export interface TelegramAdminLogGateway {
  canExportFromChat(chatId: bigint): Promise<boolean>
  validateChatForExport(chatId: bigint): Promise<ChatValidationResult>
  iterDeletedMessages(chatId: bigint, options?: AdminLogIterOptions): TelegramDeletedMessageStream
}

export interface TelegramEntitiesGateway {
  getEntityCached(entityId: TelegramPeerRef): Promise<TelegramEntityHandle | undefined>
  clearEntityCache(): void
  resolveSenderInfo(senderId: TelegramPeerRef): Promise<TelegramSenderInfo>
}

export interface TelegramMediaGateway {
  downloadMedia(messageOrHandle: DeletedMessage | TelegramMessageHandle): Promise<Blob | null>
  downloadMessageMedia(message: DeletedMessage): Promise<Blob | null>
  getChatMessagesByIds(
    chatId: TelegramPeerRef,
    messageIds: number[],
  ): Promise<Map<number, TelegramMessageHandle>>
}

export interface TelegramSendGateway {
  canSendToChat(chatId: bigint): Promise<boolean>
  sendMessage(chatId: bigint, text: string, parseMode?: 'html'): Promise<void>
  sendFile(chatId: bigint, file: Blob | File, options?: TelegramSendFileOptions): Promise<void>
  forwardMessage(fromChatId: bigint, toChatId: bigint, messageId: number): Promise<void>
}

export interface TelegramScheduledGateway {
  getScheduledMessages(chatId: bigint): Promise<ScheduledMessage[]>
  deleteScheduledMessages(chatId: bigint, messageIds: number[]): Promise<void>
}

export interface TelegramTraceGateway {
  searchOwnMessages(
    chatId: TelegramPeerRef,
    options?: OwnMessageSearchOptions,
  ): Promise<OwnMessageSearchPage>
  deleteMessages(chatId: TelegramPeerRef, messageIds: number[]): Promise<void>
  getExistingMessageIds(chatId: TelegramPeerRef, messageIds: number[]): Promise<number[]>
}

export interface TelegramAccountGateway {
  getFullMe(): Promise<FullUserInfo | null>
  downloadMyProfilePhoto(): Promise<Blob | null>
  getAccountStats(): Promise<AccountStats>
  getAccountSecurityInfo(): Promise<AccountSecurityInfo | null>
}

export interface TelegramHistoryGateway {
  iterChatMessages(chatId: TelegramPeerRef, options?: ChatHistoryOptions): TelegramChatMessageStream
  // Accepts a canonical PeerRef so a stored chat's message count can be estimated after a cold start.
  getChatMessageCount(chatId: TelegramPeerRef | PeerRef): Promise<number>
}

export interface TelegramGateway {
  readonly auth: TelegramAuthSessionGateway
  readonly dialogs: TelegramDialogsGateway
  readonly adminLog: TelegramAdminLogGateway
  readonly entities: TelegramEntitiesGateway
  readonly media: TelegramMediaGateway
  readonly send: TelegramSendGateway
  readonly scheduled: TelegramScheduledGateway
  readonly trace: TelegramTraceGateway
  readonly account: TelegramAccountGateway
  readonly history: TelegramHistoryGateway
}
