import { thtml } from '@mtcute/html-parser'
import {
  type BaseTelegramClient,
  type FileDownloadLocation,
  InputMedia,
  type InputPeerLike,
  Long,
  type Message,
  type MessageMedia,
  type Peer,
  tl,
  type User,
} from '@mtcute/web'
import {
  checkPassword,
  deleteMessagesById,
  deleteScheduledMessages as deleteScheduledMessagesMtcute,
  downloadAsBuffer,
  forwardMessagesById,
  getAllScheduledMessages,
  getChat,
  getChatEventLog,
  getFullUser,
  getHistory,
  getMe,
  getMessages,
  getPasswordHint,
  getUsers,
  iterDialogs,
  iterHistory,
  logOut,
  resolvePeer,
  searchMessages,
  sendCode,
  sendMedia,
  sendText,
  signIn,
  signInBot,
} from '@mtcute/web/methods.js'
import type { AccountSessionIssue } from '@/stores/accounts'
import type {
  AdminLogIterOptions,
  ChatHistoryOptions,
  ChatInfo,
  ChatMessage,
  ChatValidationResult,
  ConnectionState,
  DeletedMessage,
  MediaType,
  OwnMessageSearchOptions,
  OwnMessageSearchPage,
  PeerRef,
  ScheduledMessage,
  UserInfo,
} from '@/types'
import { isPeerRef, peerRefToMarkedId } from '@/utils/telegram-peers'
import { buildInputPeer } from './input-peer-builder'
import { createMtcuteClient, importSavedSession } from './mtcute-runtime'
import { peerRawId, peerToPeerRef } from './peer-adapter'
import { isRetryableTelegramReadError, sleep, withRetry } from './rate-limiter'

const RECONNECT_DELAY_MS = 2_000
const MAX_RECONNECT_ATTEMPTS = 5
const MESSAGE_FETCH_BATCH_SIZE = 100
const MEDIA_STALL_TIMEOUT_MS = 30_000

interface DeferredPromise<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

type RecoverableAuthStage = 'code' | 'password'

interface StartUserAuthOptions {
  onCodeNeeded?: () => void
  onPasswordNeeded?: (hint?: string) => void
  onRecoverableError?: (error: unknown, stage: RecoverableAuthStage) => void
}

interface UserAuthAttempt {
  id: number
  codeDeferred: DeferredPromise<string> | null
  passwordDeferred: DeferredPromise<string> | null
  onCodeNeeded: (() => void) | null
  onPasswordNeeded: ((hint?: string) => void) | null
}

function createDeferred<T>(): DeferredPromise<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function toUserInfo(user: User): UserInfo {
  return {
    id: BigInt(user.id),
    firstName: user.firstName,
    lastName: user.lastName || undefined,
    username: user.username || undefined,
    phone: user.phoneNumber || undefined,
  }
}

function isUnauthorizedError(error: unknown): boolean {
  return tl.RpcError.is(error) && error.code === tl.RpcError.UNAUTHORIZED
}

function toBlob(bytes: Uint8Array, mimeType: string): Blob {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy], { type: mimeType })
}

export class TelegramService {
  private client: BaseTelegramClient | null = null
  private sessionString = ''
  private apiId: number | null = null
  private apiHash: string | null = null

  private activeUserAuthAttempt: UserAuthAttempt | null = null
  private userAuthAttemptId = 0
  private currentUser: UserInfo | null = null

  private entityCache = new Map<string, Peer>()
  private _connectionState: ConnectionState = 'disconnected'
  private reconnectAttempts = 0
  private connectionStateListeners = new Set<(state: ConnectionState) => void>()
  private floodWaitListeners = new Set<(seconds: number, method: string) => void>()

  private _activeAccountInitPromise: Promise<boolean> | null = null
  private _activeAccountInitKey: string | null = null
  private _activeSessionAccountId: string | null = null
  private _accountTransitionGeneration = 0
  private _accountTransitionPromise: Promise<void> | null = null
  private _completeAccountTransition: (() => void) | null = null

  get isConnected(): boolean {
    return this.client?.isConnected ?? false
  }

  get user(): UserInfo | null {
    return this.currentUser
  }

  get connectionState(): ConnectionState {
    return this._connectionState
  }

  onConnectionStateChange(listener: (state: ConnectionState) => void): () => void {
    this.connectionStateListeners.add(listener)
    return () => this.connectionStateListeners.delete(listener)
  }

  private setConnectionState(state: ConnectionState): void {
    this._connectionState = state
    this.connectionStateListeners.forEach((listener) => {
      listener(state)
    })
  }

  onFloodWait(listener: (seconds: number, method: string) => void): () => void {
    this.floodWaitListeners.add(listener)
    return () => this.floodWaitListeners.delete(listener)
  }

  private emitFloodWait(seconds: number, method: string): void {
    this.floodWaitListeners.forEach((listener) => {
      listener(seconds, method)
    })
  }

  private handleRuntimeConnectionState(state: string): void {
    if (state === 'offline' && this._connectionState === 'connected') {
      this.setConnectionState('reconnecting')
    } else if (
      state === 'connected' &&
      this.currentUser !== null &&
      this._activeSessionAccountId !== null
    ) {
      this.reconnectAttempts = 0
      this.setConnectionState('connected')
    }
  }

  private cancelInteractiveAuth(reason = 'AUTH_FLOW_CANCELLED'): void {
    const attempt = this.activeUserAuthAttempt
    if (!attempt) return

    const error = new Error(reason)
    attempt.codeDeferred?.reject(error)
    attempt.passwordDeferred?.reject(error)
    this.activeUserAuthAttempt = null
  }

  private requireActiveUserAuthAttempt(attemptId: number): UserAuthAttempt {
    const attempt = this.activeUserAuthAttempt
    if (!attempt || attempt.id !== attemptId) {
      throw new Error('AUTH_FLOW_CANCELLED')
    }
    return attempt
  }

  private getRecoverableAuthStage(error: unknown): RecoverableAuthStage | null {
    const message = tl.RpcError.is(error)
      ? error.text
      : error instanceof Error
        ? error.message
        : String(error)

    if (
      message === 'PHONE_CODE_EMPTY' ||
      message === 'PHONE_CODE_INVALID' ||
      message === 'PHONE_CODE_EXPIRED' ||
      message === 'Code is empty'
    ) {
      return 'code'
    }

    if (
      message === 'PASSWORD_HASH_INVALID' ||
      message === 'SRP_ID_INVALID' ||
      message === 'Password is empty'
    ) {
      return 'password'
    }

    return null
  }

  private async getActiveUserAccountId(): Promise<string | undefined> {
    try {
      const { useAccountsStore } = await import('@/stores/accounts')
      const activeAccount = useAccountsStore().activeAccount
      return activeAccount?.type === 'user' ? activeAccount.id : undefined
    } catch {
      return undefined
    }
  }

  async initClient(apiId: number, apiHash: string): Promise<void> {
    this.apiId = apiId
    this.apiHash = apiHash

    const client = createMtcuteClient(apiId, apiHash, {
      onFloodWait: (seconds, method) => this.emitFloodWait(seconds, method),
    })
    client.onConnectionState.add((state) => this.handleRuntimeConnectionState(state))

    try {
      await importSavedSession(client, this.sessionString)
      this.client = client
    } catch (error) {
      await client.destroy().catch(() => undefined)
      throw error
    }
  }

  async connect(accountId?: string): Promise<boolean> {
    const client = this.client
    if (!client) throw new Error('Client not initialized. Call initClient first.')

    this.setConnectionState('connecting')

    try {
      await client.connect()
      const me = await getMe(client)
      this.currentUser = toUserInfo(me)
      this.reconnectAttempts = 0
      this._activeSessionAccountId = accountId ?? (await this.getActiveUserAccountId()) ?? null
      await this.refreshSessionString()
      await this.persistUserSession(accountId)
      this.setConnectionState('connected')
      return true
    } catch (error) {
      if (isUnauthorizedError(error)) {
        this.currentUser = null
        this._activeSessionAccountId = null
        this.setConnectionState('disconnected')
        return false
      }

      await client.destroy().catch(() => undefined)
      if (this.client === client) this.client = null
      this.currentUser = null
      this._activeSessionAccountId = null
      this.entityCache.clear()
      this.setConnectionState('error')
      throw error
    }
  }

  private async getConnectedClient(): Promise<BaseTelegramClient> {
    await this.waitForActiveAccountInit()
    const expectedAccountId = await this.getActiveUserAccountId()
    if (!expectedAccountId) {
      throw new Error('An active Telegram user account is required.')
    }

    if (!this.client || this._activeSessionAccountId !== expectedAccountId) {
      const restored = await this.tryRestoreSession()
      if (!restored || !this.client || this._activeSessionAccountId !== expectedAccountId) {
        await this.markActiveAccountNeedsLogin()
        throw new Error('Saved session could not be restored. Please log in again.')
      }
    }

    if (!this.client.isConnected) {
      const authorized = await this.connect(expectedAccountId)
      if (!authorized) {
        await this.disconnect()
        await this.markActiveAccountNeedsLogin()
        throw new Error('Saved session could not be restored. Please log in again.')
      }
      await this.markActiveAccountSessionReady()
    }

    return this.client
  }

  beginActiveAccountTransition(): number {
    const generation = ++this._accountTransitionGeneration
    if (!this._accountTransitionPromise) {
      this._accountTransitionPromise = new Promise<void>((resolve) => {
        this._completeAccountTransition = resolve
      })
    }
    return generation
  }

  completeActiveAccountTransition(generation: number): void {
    if (generation !== this._accountTransitionGeneration) return

    const complete = this._completeAccountTransition
    this._accountTransitionPromise = null
    this._completeAccountTransition = null
    complete?.()
  }

  markActiveUserSession(accountId: string): void {
    if (accountId) this._activeSessionAccountId = accountId
  }

  private async tryRestoreSession(): Promise<boolean> {
    try {
      const { useAccountsStore } = await import('@/stores/accounts')
      const accountsStore = useAccountsStore()
      const activeAccount = accountsStore.activeAccount
      const credentials = accountsStore.apiCredentials
      if (activeAccount?.type !== 'user' || !activeAccount.sessionString || !credentials) {
        return false
      }

      return await this.useUserAccountSession({
        accountId: activeAccount.id,
        sessionString: activeAccount.sessionString,
        apiId: credentials.apiId,
        apiHash: credentials.apiHash,
      })
    } catch (error) {
      console.error('[TelegramService] Error restoring session:', error)
      return false
    }
  }

  async useUserAccountSession(data: {
    accountId?: string
    sessionString: string
    apiId: number
    apiHash: string
  }): Promise<boolean> {
    const sessionKey = `${data.accountId ?? ''}:${data.apiId}:${data.sessionString}`

    while (this._activeAccountInitPromise) {
      if (this._activeAccountInitKey === sessionKey) return this._activeAccountInitPromise
      await this._activeAccountInitPromise.catch(() => undefined)
    }

    const initPromise = (async () => {
      try {
        if (
          data.accountId &&
          this.client?.isConnected &&
          this._activeSessionAccountId === data.accountId
        ) {
          await this.setAccountSessionState('ready', data.accountId)
          return true
        }

        await this.disconnect()
        this.sessionString = data.sessionString
        try {
          await this.initClient(data.apiId, data.apiHash)
        } catch {
          this.sessionString = ''
          await this.disconnect()
          await this.setAccountSessionState('needs_login', data.accountId, 'incompatible')
          return false
        }
        const authorized = await this.connect(data.accountId)
        if (authorized) {
          await this.setAccountSessionState('ready', data.accountId)
        } else {
          await this.disconnect()
          await this.setAccountSessionState('needs_login', data.accountId)
        }
        return authorized
      } finally {
        this._activeAccountInitPromise = null
        this._activeAccountInitKey = null
      }
    })()

    this._activeAccountInitKey = sessionKey
    this._activeAccountInitPromise = initPromise
    return initPromise
  }

  async waitForActiveAccountInit(): Promise<void> {
    while (this._accountTransitionPromise || this._activeAccountInitPromise) {
      if (this._accountTransitionPromise) {
        await this._accountTransitionPromise
      } else if (this._activeAccountInitPromise) {
        await this._activeAccountInitPromise
      }
    }
  }

  async resetForNewUserLogin(): Promise<void> {
    await this._activeAccountInitPromise?.catch(() => undefined)
    this._activeAccountInitPromise = null
    this._activeAccountInitKey = null
    await this.abortCurrentUserAuth()
    this.sessionString = ''
    this.apiId = null
    this.apiHash = null
  }

  async reconnect(): Promise<boolean> {
    if (!this.apiId || !this.apiHash) {
      throw new Error('Cannot reconnect: API credentials not available')
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setConnectionState('error')
      throw new Error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`)
    }

    this.reconnectAttempts++
    this.setConnectionState('reconnecting')
    await sleep(RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1))

    try {
      await this.client?.destroy().catch(() => undefined)
      this.client = null
      await this.initClient(this.apiId, this.apiHash)
      return await this.connect(await this.getActiveUserAccountId())
    } catch (error) {
      if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) return this.reconnect()
      throw error
    }
  }

  async manualReconnect(): Promise<boolean> {
    if (!this.apiId || !this.apiHash) {
      throw new Error('Cannot reconnect: API credentials not available. Please log in again.')
    }

    this.reconnectAttempts = 0
    this.setConnectionState('reconnecting')
    try {
      await this.client?.destroy().catch(() => undefined)
      this.client = null
      await this.initClient(this.apiId, this.apiHash)
      const authorized = await this.connect(await this.getActiveUserAccountId())
      if (!authorized) {
        await this.disconnect()
        await this.markActiveAccountNeedsLogin()
        throw new Error('Saved session could not be restored. Please log in again.')
      }
      await this.markActiveAccountSessionReady()
      return true
    } catch (error) {
      this.setConnectionState('error')
      throw error
    }
  }

  canManualReconnect(): boolean {
    return this.apiId !== null && this.apiHash !== null && this._connectionState !== 'connecting'
  }

  private async requestCode(attemptId: number): Promise<string> {
    const attempt = this.requireActiveUserAuthAttempt(attemptId)
    attempt.codeDeferred = createDeferred<string>()
    attempt.passwordDeferred = null
    attempt.onCodeNeeded?.()
    return attempt.codeDeferred.promise
  }

  private async requestPassword(attemptId: number, hint?: string): Promise<string> {
    const attempt = this.requireActiveUserAuthAttempt(attemptId)
    attempt.passwordDeferred = createDeferred<string>()
    attempt.codeDeferred = null
    attempt.onPasswordNeeded?.(hint)
    return attempt.passwordDeferred.promise
  }

  async startUserAuth(phone: string, options?: StartUserAuthOptions): Promise<UserInfo> {
    const client = this.client
    if (!client) throw new Error('Client not initialized')

    this.cancelInteractiveAuth()
    const attemptId = ++this.userAuthAttemptId
    this.activeUserAuthAttempt = {
      id: attemptId,
      codeDeferred: null,
      passwordDeferred: null,
      onCodeNeeded: options?.onCodeNeeded ?? null,
      onPasswordNeeded: options?.onPasswordNeeded ?? null,
    }

    try {
      const sentCode = await sendCode(client, { phone })
      const phoneCodeHash = 'phoneCodeHash' in sentCode ? sentCode.phoneCodeHash : null
      let authenticatedUser: User | null = phoneCodeHash ? null : (sentCode as User)

      while (!authenticatedUser) {
        if (!phoneCodeHash) throw new Error('Telegram did not return an authentication code hash')
        const code = await this.requestCode(attemptId)
        try {
          authenticatedUser = await signIn(client, {
            phone,
            phoneCodeHash,
            phoneCode: code,
          })
        } catch (error) {
          if (tl.RpcError.is(error, 'SESSION_PASSWORD_NEEDED')) {
            const hint = (await getPasswordHint(client).catch(() => null)) ?? undefined
            for (;;) {
              const password = await this.requestPassword(attemptId, hint)
              try {
                authenticatedUser = await checkPassword(client, password)
                break
              } catch (passwordError) {
                if (this.getRecoverableAuthStage(passwordError) !== 'password') throw passwordError
                options?.onRecoverableError?.(passwordError, 'password')
              }
            }
            break
          }

          if (this.getRecoverableAuthStage(error) !== 'code') throw error
          options?.onRecoverableError?.(error, 'code')
        }
      }

      this.currentUser = toUserInfo(authenticatedUser)
      await this.refreshSessionString()
      this.setConnectionState('connected')
      return this.currentUser
    } finally {
      if (this.activeUserAuthAttempt?.id === attemptId) this.cancelInteractiveAuth()
    }
  }

  provideCode(code: string): boolean {
    const deferred = this.activeUserAuthAttempt?.codeDeferred
    if (!deferred) return false
    this.activeUserAuthAttempt!.codeDeferred = null
    deferred.resolve(code)
    return true
  }

  providePassword(password: string): boolean {
    const deferred = this.activeUserAuthAttempt?.passwordDeferred
    if (!deferred) return false
    this.activeUserAuthAttempt!.passwordDeferred = null
    deferred.resolve(password)
    return true
  }

  async abortCurrentUserAuth(): Promise<void> {
    this.cancelInteractiveAuth()
    const client = this.client
    this.client = null
    await client?.destroy().catch(() => undefined)
    this.currentUser = null
    this._activeSessionAccountId = null
    this.entityCache.clear()
    this.sessionString = ''
    this.setConnectionState('disconnected')
  }

  async startBotAuth(botToken: string): Promise<UserInfo> {
    const client = this.client
    if (!client) throw new Error('Client not initialized')

    const me = await signInBot(client, botToken)
    this.currentUser = toUserInfo(me)
    await this.refreshSessionString()
    this.setConnectionState('connected')
    return this.currentUser
  }

  async disconnect(): Promise<void> {
    this.cancelInteractiveAuth()
    const client = this.client
    this.client = null
    try {
      await client?.destroy()
    } finally {
      this.currentUser = null
      this._activeSessionAccountId = null
      this.entityCache.clear()
      this.setConnectionState('disconnected')
    }
  }

  async logout(): Promise<void> {
    if (this.client) await logOut(this.client).catch(() => undefined)
    this.sessionString = ''
    await this.disconnect()
  }

  private async refreshSessionString(): Promise<void> {
    if (!this.client) return
    this.sessionString = await this.client.exportSession()
  }

  private async setAccountSessionState(
    state: 'ready' | 'needs_login',
    accountId?: string,
    issue: AccountSessionIssue = 'expired',
  ): Promise<void> {
    try {
      const { useAccountsStore } = await import('@/stores/accounts')
      const accountsStore = useAccountsStore()
      const targetAccountId = accountId ?? accountsStore.activeAccount?.id
      const target = accountsStore.accounts.find((account) => account.id === targetAccountId)
      if (!target || target.type !== 'user') return

      if (state === 'ready') accountsStore.markAccountSessionReady(target.id)
      else accountsStore.markAccountNeedsLogin(target.id, issue)
    } catch (error) {
      console.warn('[TelegramService] Failed to update account session state:', error)
    }
  }

  private async markActiveAccountSessionReady(): Promise<void> {
    await this.setAccountSessionState('ready')
  }

  private async markActiveAccountNeedsLogin(): Promise<void> {
    await this.setAccountSessionState('needs_login')
  }

  private async persistUserSession(accountId?: string): Promise<void> {
    if (!this.sessionString) return

    try {
      const { useAccountsStore } = await import('@/stores/accounts')
      const accountsStore = useAccountsStore()
      const targetAccountId = accountId ?? accountsStore.activeAccount?.id
      const target = accountsStore.accounts.find((account) => account.id === targetAccountId)
      if (!target || target.type !== 'user' || target.sessionString === this.sessionString) return

      await accountsStore.updateAccount(target.id, { sessionString: this.sessionString })
      accountsStore.markAccountSessionReady(target.id)
    } catch (error) {
      console.warn('[TelegramService] Failed to persist refreshed session:', error)
    }
  }

  getSessionString(): string {
    return this.sessionString
  }

  restoreSession(sessionString: string): void {
    this.sessionString = sessionString
  }

  exportSession(): { sessionString: string; apiId?: number; apiHash?: string } | null {
    if (!this.sessionString) return null
    return {
      sessionString: this.sessionString,
      apiId: this.apiId ?? undefined,
      apiHash: this.apiHash ?? undefined,
    }
  }

  importSession(data: { sessionString: string; apiId?: number; apiHash?: string }): boolean {
    if (!data.sessionString) return false
    this.sessionString = data.sessionString
    if (data.apiId && data.apiHash) {
      this.apiId = data.apiId
      this.apiHash = data.apiHash
    }
    return true
  }

  hasStoredCredentials(): boolean {
    return this.apiId !== null && this.apiHash !== null
  }

  private cachePeer(peer: Peer): void {
    this.entityCache.set(String(peer.id), peer)
    this.entityCache.set(peerRawId(peer), peer)
  }

  private async resolvePeerInput(
    client: BaseTelegramClient,
    value: bigint | string | PeerRef,
  ): Promise<InputPeerLike> {
    if (isPeerRef(value)) {
      return buildInputPeer(value) ?? Number(peerRefToMarkedId(value))
    }

    const key = value.toString()
    const cached = this.entityCache.get(key)
    if (cached) return cached

    const numeric = Number(key)
    if (!Number.isSafeInteger(numeric)) throw new Error(`Telegram peer ID is out of range: ${key}`)
    return resolvePeer(client, numeric)
  }

  async getDialogs(limit?: number): Promise<ChatInfo[]> {
    const client = await this.getConnectedClient()
    const chats: ChatInfo[] = []

    for await (const dialog of iterDialogs(client, {
      limit,
      archived: 'keep',
      pinned: 'keep',
    })) {
      const peer = dialog.peer
      this.cachePeer(peer)
      const isChat = peer.type === 'chat'
      const isAdmin = isChat && (peer.isAdmin || peer.isCreator)
      const type: ChatInfo['type'] =
        peer.type === 'user'
          ? 'user'
          : peer.chatType === 'channel'
            ? 'channel'
            : peer.chatType === 'group'
              ? 'group'
              : 'supergroup'

      chats.push({
        id: BigInt(peerRawId(peer)),
        peerId: String(peer.id),
        peerRef: peerToPeerRef(peer),
        title: peer.displayName,
        type,
        username: peer.username || undefined,
        participantCount: isChat ? (peer.membersCount ?? undefined) : undefined,
        canExport: isAdmin && (type === 'channel' || type === 'supergroup'),
        canSend: this.canSendToPeer(peer),
        isAdmin,
        lastMessageDate: dialog.lastMessage?.date,
      })
    }

    return chats
  }

  async canExportFromChat(chatId: bigint): Promise<boolean> {
    return (await this.validateChatForExport(chatId)).canExport
  }

  async validateChatForExport(chatId: bigint): Promise<ChatValidationResult> {
    await this.waitForActiveAccountInit()
    if (!this.client) {
      return {
        valid: false,
        canExport: false,
        reason: 'unknown_error',
        errorMessage: 'Client not connected',
      }
    }

    try {
      const entity = await this.getEntityCached(chatId)
      if (!entity) {
        return {
          valid: false,
          canExport: false,
          reason: 'not_found',
          errorMessage: 'Chat not found',
        }
      }

      const chatTitle = entity.displayName
      if (
        entity.type !== 'chat' ||
        !['channel', 'supergroup', 'gigagroup'].includes(entity.chatType)
      ) {
        return {
          valid: true,
          canExport: false,
          reason: 'not_channel',
          chatType: entity.type === 'user' ? 'user' : entity.chatType,
          chatTitle,
          errorMessage: `Cannot export from this chat type. Admin logs are only available for channels and supergroups.`,
        }
      }

      if (!entity.isAdmin && !entity.isCreator) {
        return {
          valid: true,
          canExport: false,
          reason: 'no_admin_rights',
          chatType: entity.chatType,
          chatTitle,
          errorMessage: `You don't have admin rights in "${chatTitle}".`,
        }
      }

      const client = await this.getConnectedClient()
      await getChatEventLog(client, entity, { filters: 'msg_deleted', limit: 1 })
      return { valid: true, canExport: true, chatType: entity.chatType, chatTitle }
    } catch (error) {
      return {
        valid: false,
        canExport: false,
        reason: 'unknown_error',
        errorMessage: `Failed to validate chat: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  async *iterDeletedMessages(
    chatId: bigint,
    options: AdminLogIterOptions = {},
  ): AsyncGenerator<DeletedMessage> {
    const validation = await this.validateChatForExport(chatId)
    if (!validation.canExport) {
      throw new Error(validation.errorMessage || 'Cannot export from this chat')
    }

    const client = await this.getConnectedClient()
    const peer = await this.resolvePeerInput(client, chatId)
    let maxId = Long.fromNumber(options.maxId ?? 0)
    const minId = Long.fromNumber(options.minId ?? 0)
    const maximum = options.limit ?? Infinity
    let yielded = 0

    while (yielded < maximum) {
      const events = await getChatEventLog(client, peer, {
        filters: 'msg_deleted',
        maxId,
        minId,
        limit: Math.min(MESSAGE_FETCH_BATCH_SIZE, maximum - yielded),
      })
      if (events.length === 0) break

      for (const event of events) {
        const action = event.action
        if (action?.type !== 'msg_deleted') continue
        const message = action.message
        if (options.minDate && message.date < options.minDate) continue
        if (options.maxDate && message.date > options.maxDate) continue

        yielded++
        yield this.toDeletedMessage(message, chatId)
        if (yielded >= maximum) return
      }

      const next = events.at(-1)?.id
      if (!next || next.eq(maxId)) break
      maxId = next
    }
  }

  private mediaType(media: MessageMedia): MediaType | undefined {
    if (!media) return undefined
    switch (media.type) {
      case 'photo':
        return 'photo'
      case 'video':
        if (media.isRound) return 'videoNote'
        if (media.isAnimation) return 'animation'
        return 'video'
      case 'document':
        return 'document'
      case 'sticker':
        return 'sticker'
      case 'voice':
        return 'voice'
      case 'audio':
        return 'audio'
      case 'poll':
        return 'poll'
      case 'location':
      case 'live_location':
        return 'location'
      case 'contact':
        return 'contact'
      default:
        return undefined
    }
  }

  private mediaMimeType(media: MessageMedia): string | undefined {
    if (!media) return undefined
    if (media.type === 'photo') return 'image/jpeg'
    if ('mimeType' in media) return media.mimeType
    return undefined
  }

  private mediaFilename(media: MessageMedia, messageId: number): string | undefined {
    if (!media) return undefined
    if ('fileName' in media && media.fileName) return media.fileName
    if (media.type === 'photo') return `photo_${messageId}.jpg`
    if (media.type === 'video') return `video_${messageId}.mp4`
    if (media.type === 'voice') return `voice_${messageId}.ogg`
    if (media.type === 'audio') return `audio_${messageId}.mp3`
    if (media.type === 'sticker') return `sticker_${messageId}`
    return undefined
  }

  private extractMediaInfo(message: Message): {
    hasMedia: boolean
    mediaType?: MediaType
    mediaFilename?: string
    mediaSize?: number
    mediaMimeType?: string
  } {
    const media = message.media
    if (!media) return { hasMedia: false }
    return {
      hasMedia: true,
      mediaType: this.mediaType(media),
      mediaFilename: this.mediaFilename(media, message.id),
      mediaSize: 'fileSize' in media ? media.fileSize : undefined,
      mediaMimeType: this.mediaMimeType(media),
    }
  }

  private cacheMessagePeers(message: Message): void {
    this.cachePeer(message.chat)
    this.cachePeer(message.sender)
  }

  private toDeletedMessage(message: Message, chatId: bigint): DeletedMessage {
    this.cacheMessagePeers(message)
    const sender = message.sender
    const reply = message.replyToMessage
    return {
      id: message.id,
      chatId,
      senderId: BigInt(peerRawId(sender)),
      text: message.text || undefined,
      date: message.date,
      ...this.extractMediaInfo(message),
      replyToMsgId: reply?.id ?? undefined,
      replyToTopId: reply?.threadId ?? undefined,
      quoteText: reply?.quoteText || undefined,
      _rawMessage: message.media ? message : undefined,
    }
  }

  async downloadMedia(messageOrHandle: DeletedMessage | unknown): Promise<Blob | null> {
    const client = await this.getConnectedClient()
    const candidate =
      messageOrHandle && typeof messageOrHandle === 'object' && '_rawMessage' in messageOrHandle
        ? (messageOrHandle as DeletedMessage)._rawMessage
        : messageOrHandle
    const media =
      candidate && typeof candidate === 'object' && 'media' in candidate
        ? (candidate as Message).media
        : (candidate as MessageMedia)

    if (!media || !('location' in media)) return null
    const bytes = await withRetry(
      () =>
        downloadAsBuffer(client, media as FileDownloadLocation, {
          stallTimeout: MEDIA_STALL_TIMEOUT_MS,
        }),
      { shouldRetry: isRetryableTelegramReadError },
    )
    return toBlob(bytes, this.mediaMimeType(media) || 'application/octet-stream')
  }

  async downloadMessageMedia(message: DeletedMessage): Promise<Blob | null> {
    return this.downloadMedia(message)
  }

  async getChatMessagesByIds(
    chatId: bigint | string,
    messageIds: number[],
  ): Promise<Map<number, Message>> {
    if (messageIds.length === 0) return new Map()
    const client = await this.getConnectedClient()
    const peer = await this.resolvePeerInput(client, chatId)
    const messages = await getMessages(client, peer, messageIds)
    const result = new Map<number, Message>()
    for (const message of messages) {
      if (!message) continue
      this.cacheMessagePeers(message)
      result.set(message.id, message)
    }
    return result
  }

  async getEntityCached(entityId: bigint | string): Promise<Peer | undefined> {
    const key = entityId.toString()
    const cached = this.entityCache.get(key)
    if (cached) return cached

    const client = await this.getConnectedClient()
    const inputPeer = await this.resolvePeerInput(client, entityId)
    const resolved = await resolvePeer(client, inputPeer)
    const markedId =
      resolved._ === 'inputPeerUser'
        ? Number(resolved.userId.toString())
        : resolved._ === 'inputPeerChat'
          ? -Number(resolved.chatId.toString())
          : resolved._ === 'inputPeerChannel'
            ? Number(`-100${resolved.channelId.toString()}`)
            : 0

    const peer =
      markedId > 0 ? (await getUsers(client, resolved))[0] : await getChat(client, resolved)
    if (!peer) return undefined
    this.cachePeer(peer)
    return peer
  }

  clearEntityCache(): void {
    this.entityCache.clear()
  }

  async resolveSenderInfo(
    senderId: bigint | string,
  ): Promise<{ name?: string; username?: string }> {
    try {
      const peer = await this.getEntityCached(senderId)
      return peer ? { name: peer.displayName, username: peer.username || undefined } : {}
    } catch {
      return {}
    }
  }

  async canSendToChat(chatId: bigint): Promise<boolean> {
    try {
      const peer = await this.getEntityCached(chatId)
      return peer ? this.canSendToPeer(peer) : false
    } catch {
      return false
    }
  }

  private canSendToPeer(peer: Peer): boolean {
    if (peer.type === 'user') return true
    if (peer.chatType === 'channel') {
      return peer.isCreator || !!peer.adminRights?.postMessages
    }
    return peer.permissions?.canSendMessages ?? true
  }

  private formatText(text: string, parseMode?: 'html') {
    if (parseMode === 'html') return thtml(text)
    return text
  }

  async sendMessage(chatId: bigint, text: string, parseMode?: 'html'): Promise<void> {
    const client = await this.getConnectedClient()
    const peer = await this.resolvePeerInput(client, chatId)
    await sendText(client, peer, this.formatText(text, parseMode), { silent: true })
  }

  async sendFile(
    chatId: bigint,
    file: Blob | File,
    options: {
      caption?: string
      parseMode?: 'html'
      forceDocument?: boolean
      filename?: string
    } = {},
  ): Promise<void> {
    const client = await this.getConnectedClient()
    const peer = await this.resolvePeerInput(client, chatId)
    const filename =
      options.filename ||
      (typeof File !== 'undefined' && file instanceof File ? file.name : undefined)
    const params = {
      fileName: filename,
      fileMime: file.type || undefined,
      caption: options.caption ? this.formatText(options.caption, options.parseMode) : undefined,
    }
    const media = options.forceDocument
      ? InputMedia.document(file, params)
      : file.type.startsWith('image/') && file.type !== 'image/gif'
        ? InputMedia.photo(file, params)
        : file.type.startsWith('video/')
          ? InputMedia.video(file, params)
          : InputMedia.auto(file, params)

    await sendMedia(client, peer, media, { silent: true })
  }

  async forwardMessage(fromChatId: bigint, toChatId: bigint, messageId: number): Promise<void> {
    const client = await this.getConnectedClient()
    await forwardMessagesById(client, {
      fromChatId: await this.resolvePeerInput(client, fromChatId),
      toChatId: await this.resolvePeerInput(client, toChatId),
      messages: [messageId],
      silent: true,
    })
  }

  async getScheduledMessages(chatId: bigint): Promise<ScheduledMessage[]> {
    const client = await this.getConnectedClient()
    const peer = await this.resolvePeerInput(client, chatId)
    const messages = await getAllScheduledMessages(client, peer)

    return messages
      .map((message) => {
        this.cacheMessagePeers(message)
        return {
          id: message.id,
          chatId,
          text: message.text || undefined,
          date: message.editDate ?? message.date,
          scheduledDate: message.date,
          ...this.extractMediaInfo(message),
          replyToMsgId: message.replyToMessage?.id ?? undefined,
          _rawMessage: message.media ? message : undefined,
        }
      })
      .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())
  }

  async deleteScheduledMessages(chatId: bigint, messageIds: number[]): Promise<void> {
    if (messageIds.length === 0) return
    const client = await this.getConnectedClient()
    await deleteScheduledMessagesMtcute(
      client,
      await this.resolvePeerInput(client, chatId),
      messageIds,
    )
  }

  async searchOwnMessages(
    chatId: bigint | string,
    options: OwnMessageSearchOptions = {},
  ): Promise<OwnMessageSearchPage> {
    const client = await this.getConnectedClient()
    const limit = Math.min(100, Math.max(1, options.limit ?? MESSAGE_FETCH_BATCH_SIZE))
    const result = await searchMessages(client, {
      chatId: await this.resolvePeerInput(client, chatId),
      fromUser: 'self',
      offset: options.offsetId,
      minDate: options.minDate,
      maxDate: options.maxDate,
      limit,
    })

    return {
      messages: result.map((message) => ({
        id: message.id,
        date: message.date,
        preview: message.text.trim()
          ? ({ kind: 'text', text: message.text } as const)
          : ({ kind: 'non_text' } as const),
      })),
      total: result.total,
      nextOffsetId: result.next,
    }
  }

  async deleteMessages(chatId: bigint | string, messageIds: number[]): Promise<void> {
    if (messageIds.length === 0) return
    const client = await this.getConnectedClient()
    await deleteMessagesById(client, await this.resolvePeerInput(client, chatId), messageIds, {
      revoke: true,
    })
  }

  async getExistingMessageIds(chatId: bigint | string, messageIds: number[]): Promise<number[]> {
    return [...(await this.getChatMessagesByIds(chatId, messageIds)).keys()]
  }

  async *iterChatMessages(
    chatId: bigint | string,
    options: ChatHistoryOptions = {},
  ): AsyncGenerator<ChatMessage> {
    const client = await this.getConnectedClient()
    const peer = await this.resolvePeerInput(client, chatId)
    const reverse = options.reverse ?? false
    const offsetDate = reverse ? options.minDate : options.maxDate
    const offset =
      options.offsetId !== undefined || offsetDate
        ? {
            id: options.offsetId ?? (reverse ? 1 : 0),
            date: offsetDate ? Math.floor(offsetDate.getTime() / 1000) : 0,
          }
        : undefined

    for await (const message of iterHistory(client, peer, {
      limit: options.limit,
      reverse,
      offset,
    })) {
      if (options.minDate && message.date < options.minDate) {
        if (!reverse) break
        continue
      }
      if (options.maxDate && message.date > options.maxDate) {
        if (reverse) break
        continue
      }

      this.cacheMessagePeers(message)
      const sender = message.sender
      const forwardSender = message.forward?.sender
      yield {
        id: message.id,
        chatId: BigInt(peerRawId(message.chat)),
        chatPeerId: String(message.chat.id),
        senderId: BigInt(peerRawId(sender)),
        senderPeerId: String(sender.id),
        text: message.text || undefined,
        date: message.date,
        replyToMsgId: message.replyToMessage?.id ?? undefined,
        ...this.extractMediaInfo(message),
        forwardedFrom: forwardSender?.displayName,
      }
    }
  }

  async getChatMessageCount(chatId: bigint | string | PeerRef): Promise<number> {
    const client = await this.getConnectedClient()
    const page = await getHistory(client, await this.resolvePeerInput(client, chatId), { limit: 1 })
    return page.total
  }

  async getFullMe(): Promise<FullUserInfo | null> {
    const client = await this.getConnectedClient()
    try {
      const user = await getFullUser(client, 'self')
      return {
        id: BigInt(user.id),
        firstName: user.firstName,
        lastName: user.lastName || undefined,
        username: user.username || undefined,
        phone: user.phoneNumber || undefined,
        bio: user.bio || undefined,
        isPremium: user.isPremium,
        isVerified: user.isVerified,
        isRestricted: user.isRestricted,
        restrictionReason:
          user.restrictionReason.map((item) => item.reason).join(', ') || undefined,
        commonChatsCount: user.commonChatsCount,
        activeUsernames:
          user.usernames
            ?.filter((item) => item.active && item.username !== user.username)
            .map((item) => item.username) ?? [],
        languageCode: user.language || undefined,
        birthday: user.birthday
          ? {
              day: user.birthday.day,
              month: user.birthday.month,
              year: user.birthday.year,
            }
          : undefined,
        hasProfilePhoto: !!user.photo,
        hasProfileVideo: !!user.photo?.raw.hasVideo,
        dcId: user.dcId ?? undefined,
      }
    } catch (error) {
      console.error('Failed to get full user info:', error)
      return null
    }
  }

  async downloadMyProfilePhoto(): Promise<Blob | null> {
    const client = await this.getConnectedClient()
    try {
      const user = await getMe(client)
      if (!user.photo) return null
      const bytes = await withRetry(
        () =>
          downloadAsBuffer(client, user.photo!.big, {
            stallTimeout: MEDIA_STALL_TIMEOUT_MS,
          }),
        { shouldRetry: isRetryableTelegramReadError },
      )
      return toBlob(bytes, 'image/jpeg')
    } catch (error) {
      console.error('Failed to download profile photo:', error)
      return null
    }
  }

  async getAccountStats(): Promise<AccountStats> {
    const client = await this.getConnectedClient()
    try {
      const [dialogs, contacts, blocked] = await Promise.all([
        client.call({
          _: 'messages.getDialogs',
          offsetDate: 0,
          offsetId: 0,
          offsetPeer: { _: 'inputPeerEmpty' },
          limit: 1,
          hash: Long.ZERO,
        }),
        client.call({ _: 'contacts.getContacts', hash: Long.ZERO }),
        client.call({ _: 'contacts.getBlocked', offset: 0, limit: 1 }),
      ])

      return {
        dialogsCount: 'count' in dialogs ? dialogs.count : dialogs.dialogs.length,
        contactsCount: 'contacts' in contacts ? contacts.contacts.length : 0,
        blockedCount: 'count' in blocked ? blocked.count : blocked.blocked.length,
      }
    } catch (error) {
      console.error('Failed to get account stats:', error)
      return { dialogsCount: 0, contactsCount: 0, blockedCount: 0 }
    }
  }

  async getAccountSecurityInfo(): Promise<AccountSecurityInfo | null> {
    const client = await this.getConnectedClient()
    try {
      const [authorizations, accountTtl, password] = await Promise.all([
        withRetry(() => client.call({ _: 'account.getAuthorizations' }), {
          shouldRetry: isRetryableTelegramReadError,
        }),
        withRetry(() => client.call({ _: 'account.getAccountTTL' }), {
          shouldRetry: isRetryableTelegramReadError,
        }),
        withRetry(() => client.call({ _: 'account.getPassword' }), {
          shouldRetry: isRetryableTelegramReadError,
        }),
      ])
      const current = authorizations.authorizations.find((authorization) => authorization.current)

      return {
        twoStepVerificationEnabled: !!password.hasPassword,
        recoveryEmailConfigured: !!password.hasRecovery,
        authorizedSessionsCount: authorizations.authorizations.length,
        otherSessionsCount: authorizations.authorizations.filter((item) => !item.current).length,
        unconfirmedSessionsCount: authorizations.authorizations.filter((item) => item.unconfirmed)
          .length,
        authorizationTtlDays: authorizations.authorizationTtlDays,
        accountTtlDays: accountTtl.days,
        currentSession: current
          ? {
              appName: current.appName,
              appVersion: current.appVersion,
              deviceModel: current.deviceModel,
              platform: current.platform,
              systemVersion: current.systemVersion,
              location: [current.country, current.region].filter(Boolean).join(', '),
              createdAt: new Date(current.dateCreated * 1000),
              lastActiveAt: new Date(current.dateActive * 1000),
              officialApp: !!current.officialApp,
            }
          : undefined,
      }
    } catch (error) {
      console.error('Failed to get account security info:', error)
      return null
    }
  }
}

export interface FullUserInfo {
  id: bigint
  firstName: string
  lastName?: string
  username?: string
  phone?: string
  bio?: string
  isPremium: boolean
  isVerified: boolean
  isRestricted: boolean
  restrictionReason?: string
  commonChatsCount: number
  activeUsernames: string[]
  languageCode?: string
  birthday?: {
    day: number
    month: number
    year?: number
  }
  hasProfilePhoto: boolean
  hasProfileVideo: boolean
  dcId?: number
}

export interface AccountStats {
  dialogsCount: number
  contactsCount: number
  blockedCount: number
}

export interface AccountSessionInfo {
  appName: string
  appVersion: string
  deviceModel: string
  platform: string
  systemVersion: string
  location: string
  createdAt: Date
  lastActiveAt: Date
  officialApp: boolean
}

export interface AccountSecurityInfo {
  twoStepVerificationEnabled: boolean
  recoveryEmailConfigured: boolean
  authorizedSessionsCount: number
  otherSessionsCount: number
  unconfirmedSessionsCount: number
  authorizationTtlDays: number
  accountTtlDays: number
  currentSession?: AccountSessionInfo
}

declare global {
  var __MOCK_TELEGRAM__: boolean | undefined
  var __mockTelegramService__: unknown | undefined
}

const globalScope = globalThis as typeof globalThis & {
  __MOCK_TELEGRAM__?: boolean
  __mockTelegramService__?: unknown
}
const selectedMock = globalScope.__MOCK_TELEGRAM__ === true && !!globalScope.__mockTelegramService__

export const telegramService = (
  selectedMock ? globalScope.__mockTelegramService__ : new TelegramService()
) as TelegramService
