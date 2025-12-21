/**
 * Telegram client wrapper around GramJS
 *
 * Uses the proper GramJS start() method with callbacks for authentication.
 * See: https://gram.js.org/getting-started/authorization
 */

import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import type {
  UserInfo,
  ChatInfo,
  DeletedMessage,
  MediaType,
  AdminLogIterOptions,
  ChatValidationResult,
  ConnectionState,
} from '@/types'

// Reconnection settings
const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 5

// Deferred promise helper for interactive auth flow
interface DeferredPromise<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
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

class TelegramService {
  private client: TelegramClient | null = null
  private session: StringSession
  private apiId: number | null = null
  private apiHash: string | null = null

  // Auth flow state
  private phoneDeferred: DeferredPromise<string> | null = null
  private codeDeferred: DeferredPromise<string> | null = null
  private passwordDeferred: DeferredPromise<string> | null = null
  private currentUser: UserInfo | null = null

  // Entity cache for sender resolution (like Python's _entity_cache)
  private entityCache: Map<string, unknown> = new Map()

  // Connection state management
  private _connectionState: ConnectionState = 'disconnected'
  private reconnectAttempts = 0
  private connectionStateListeners: Set<(state: ConnectionState) => void> = new Set()

  // Race-free initialization orchestrator: if an account switch/init is in-flight, callers can await this.
  private _activeAccountInitPromise: Promise<boolean> | null = null

  constructor() {
    // IMPORTANT: This service supports multiple accounts. We intentionally do NOT
    // read/write a single "global" session from localStorage here, because it causes
    // cross-account session leakage (e.g. adding a new phone instantly appears "logged in").
    //
    // The canonical session persistence is `SavedAccount.sessionString` inside `telegram_accounts`.
    this.session = new StringSession('')
  }

  get isConnected(): boolean {
    return this.client?.connected ?? false
  }

  get user(): UserInfo | null {
    return this.currentUser
  }

  get connectionState(): ConnectionState {
    return this._connectionState
  }

  /**
   * Subscribe to connection state changes
   */
  onConnectionStateChange(listener: (state: ConnectionState) => void): () => void {
    this.connectionStateListeners.add(listener)
    return () => this.connectionStateListeners.delete(listener)
  }

  private setConnectionState(state: ConnectionState): void {
    this._connectionState = state
    this.connectionStateListeners.forEach((listener) => listener(state))
  }

  /**
   * Initialize client with API credentials
   */
  async initClient(apiId: number, apiHash: string): Promise<void> {
    // Store credentials for reconnection
    this.apiId = apiId
    this.apiHash = apiHash

    // GramJS sends these fields inside InitConnection. Telegram can reject empty/invalid values
    // with errors like `CONNECTION_SYSTEM_EMPTY`. In browsers, Node's `os` module isn't available,
    // so we provide stable values here explicitly.
    const nav = typeof navigator !== 'undefined' ? navigator : null
    const lang = (nav?.language ?? 'en').split('-')[0] || 'en'
    const deviceModel = `Web${nav?.platform ? ` (${nav.platform})` : ''}`
    const systemVersion = (nav?.userAgent ?? 'Web').slice(0, 64)

    this.client = new TelegramClient(this.session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true,
      deviceModel,
      systemVersion,
      appVersion: '1.0',
      langCode: lang,
      systemLangCode: lang,
    })
  }

  /**
   * Connect and check if already authorized
   */
  async connect(): Promise<boolean> {
    if (!this.client) {
      throw new Error('Client not initialized. Call initClient first.')
    }

    this.setConnectionState('connecting')

    try {
      await this.client.connect()
      this.reconnectAttempts = 0

      if (await this.client.isUserAuthorized()) {
        const me = await this.client.getMe()
        if (me) {
          this.currentUser = {
            id: BigInt(me.id.toString()),
            firstName: me.firstName || '',
            lastName: me.lastName || undefined,
            username: me.username || undefined,
          }
          this.saveSession()
          this.setConnectionState('connected')
          return true
        }
      }

      this.setConnectionState('connected')
      return false
    } catch (error) {
      this.setConnectionState('error')
      throw error
    }
  }

  private async getConnectedClient(): Promise<TelegramClient> {
    // Wait for any in-flight account initialization to complete first (race-free orchestration).
    await this.waitForActiveAccountInit()

    if (!this.client) {
      throw new Error('Client not initialized. Please log in again.')
    }
    if (!this.client.connected) {
      await this.connect()
    }
    if (!this.client) {
      throw new Error('Client not initialized. Please log in again.')
    }
    return this.client
  }

  /**
   * Switch the underlying Telegram client/session to a specific user account.
   * This is required for correct multi-account behavior.
   *
   * This method is the **single entry-point** for activating a user account's session.
   * It sets `_activeAccountInitPromise` so that concurrent callers (e.g. ExportView calling
   * `getDialogs()` while App.vue is still connecting) will await until initialization completes.
   */
  async useUserAccountSession(data: {
    sessionString: string
    apiId: number
    apiHash: string
  }): Promise<boolean> {
    // If there's already an in-flight init for the same session, just return that promise.
    // (Avoids duplicate connects on rapid watcher triggers.)
    if (this._activeAccountInitPromise) {
      return this._activeAccountInitPromise
    }

    const initPromise = (async () => {
      try {
        await this.disconnect()
        this.currentUser = null
        this.entityCache.clear()
        this.session = new StringSession(data.sessionString || '')
        await this.initClient(data.apiId, data.apiHash)
        return await this.connect()
      } finally {
        // Clear the promise once done so future switches can proceed.
        this._activeAccountInitPromise = null
      }
    })()

    this._activeAccountInitPromise = initPromise
    return initPromise
  }

  /**
   * Wait for any in-flight account initialization to complete.
   * Useful for APIs that need the client to be ready before proceeding.
   */
  async waitForActiveAccountInit(): Promise<void> {
    if (this._activeAccountInitPromise) {
      await this._activeAccountInitPromise
    }
  }

  /**
   * Prepare for starting a brand-new user login flow (new phone).
   * Clears any existing session so we don't accidentally reuse another account's auth.
   */
  async resetForNewUserLogin(): Promise<void> {
    await this.disconnect()
    this.currentUser = null
    this.entityCache.clear()
    this.session = new StringSession('')
    this.apiId = null
    this.apiHash = null
  }

  /**
   * Attempt to reconnect after connection loss (auto-reconnect with backoff)
   */
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

    // Exponential backoff
    const delay = RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1)
    await new Promise((resolve) => setTimeout(resolve, delay))

    try {
      await this.initClient(this.apiId, this.apiHash)
      const result = await this.connect()
      return result
    } catch (error) {
      console.error(`Reconnection attempt ${this.reconnectAttempts} failed:`, error)
      if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        return this.reconnect()
      }
      throw error
    }
  }

  /**
   * Manual reconnect - use when user explicitly wants to reconnect
   * (e.g., after regaining network on a train)
   * Resets retry counter and attempts immediate reconnection
   */
  async manualReconnect(): Promise<boolean> {
    if (!this.apiId || !this.apiHash) {
      throw new Error('Cannot reconnect: API credentials not available. Please log in again.')
    }

    // Reset retry counter for manual reconnect
    this.reconnectAttempts = 0
    this.setConnectionState('reconnecting')

    try {
      // Disconnect existing client if any
      if (this.client) {
        try {
          await this.client.disconnect()
        } catch {
          // Ignore disconnect errors
        }
        this.client = null
      }

      // Reinitialize and connect
      await this.initClient(this.apiId, this.apiHash)
      const result = await this.connect()

      if (result) {
        this.setConnectionState('connected')
      }

      return result
    } catch (error) {
      this.setConnectionState('error')
      throw error
    }
  }

  /**
   * Check if manual reconnect is available
   */
  canManualReconnect(): boolean {
    return this.apiId !== null && this.apiHash !== null && this._connectionState !== 'connecting'
  }

  /**
   * Start user authentication flow
   * Returns a promise that resolves when auth is complete
   */
  async startUserAuth(phone: string): Promise<UserInfo> {
    if (!this.client) {
      throw new Error('Client not initialized')
    }

    // Create deferreds for interactive flow
    this.phoneDeferred = createDeferred<string>()
    this.codeDeferred = createDeferred<string>()
    this.passwordDeferred = createDeferred<string>()

    // Resolve phone immediately since we already have it
    this.phoneDeferred.resolve(phone)

    try {
      await this.client.start({
        phoneNumber: async () => {
          return this.phoneDeferred!.promise
        },
        phoneCode: async () => {
          return this.codeDeferred!.promise
        },
        password: async () => {
          return this.passwordDeferred!.promise
        },
        onError: (err) => {
          console.error('Auth error:', err)
          throw err
        },
      })

      const me = await this.client.getMe()
      if (me) {
        this.currentUser = {
          id: BigInt(me.id.toString()),
          firstName: me.firstName || '',
          lastName: me.lastName || undefined,
          username: me.username || undefined,
        }
        this.saveSession()
        return this.currentUser
      }
      throw new Error('Failed to get user info')
    } finally {
      this.phoneDeferred = null
      this.codeDeferred = null
      this.passwordDeferred = null
    }
  }

  /**
   * Provide the verification code (called from UI)
   */
  provideCode(code: string): void {
    if (this.codeDeferred) {
      this.codeDeferred.resolve(code)
    }
  }

  /**
   * Provide the 2FA password (called from UI)
   */
  providePassword(password: string): void {
    if (this.passwordDeferred) {
      this.passwordDeferred.resolve(password)
    }
  }

  /**
   * Start bot authentication
   */
  async startBotAuth(botToken: string): Promise<UserInfo> {
    if (!this.client) {
      throw new Error('Client not initialized')
    }

    await this.client.start({
      botAuthToken: botToken,
    })

    const me = await this.client.getMe()
    if (me) {
      this.currentUser = {
        id: BigInt(me.id.toString()),
        firstName: me.firstName || '',
        lastName: me.lastName || undefined,
        username: me.username || undefined,
      }
      this.saveSession()
      return this.currentUser
    }
    throw new Error('Failed to get bot info')
  }

  /**
   * Disconnect and logout
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect()
      this.client = null
    }
    this.currentUser = null
  }

  /**
   * Logout and clear session
   */
  async logout(): Promise<void> {
    if (this.client) {
      try {
        await this.client.invoke({ _: 'auth.logOut' } as any)
      } catch {
        // Ignore logout errors
      }
      await this.disconnect()
    }
    this.session = new StringSession('')
  }

  private saveSession(): void {
    const sessionString = this.session.save()
    void sessionString
  }

  /**
   * Get session string for storage
   */
  getSessionString(): string {
    return this.session.save()
  }

  /**
   * Restore session from string
   */
  restoreSession(sessionString: string): void {
    this.session = new StringSession(sessionString)
  }

  /**
   * Get list of dialogs/chats
   */
  async getDialogs(limit = 100): Promise<ChatInfo[]> {
    const client = await this.getConnectedClient()
    const dialogs = await client.getDialogs({ limit })
    const chats: ChatInfo[] = []

    for (const dialog of dialogs) {
      const entity = dialog.entity
      if (!entity) continue

      const id = BigInt(entity.id.toString())
      let type: ChatInfo['type'] = 'user'
      let canExport = false
      let canSend = true

      if ('broadcast' in entity && entity.broadcast) {
        type = 'channel'
        canExport = !!(entity as any).adminRights
      } else if ('megagroup' in entity && entity.megagroup) {
        type = 'supergroup'
        canExport = !!(entity as any).adminRights
      } else if ('gigagroup' in entity) {
        type = 'supergroup'
        canExport = !!(entity as any).adminRights
      } else if ('title' in entity) {
        type = 'group'
      }

      chats.push({
        id,
        title:
          'title' in entity
            ? entity.title
            : 'firstName' in entity
              ? `${entity.firstName || ''} ${entity.lastName || ''}`.trim()
              : 'Unknown',
        type,
        username: 'username' in entity ? entity.username || undefined : undefined,
        canExport,
        canSend,
        lastMessageDate: dialog.message?.date ? new Date(dialog.message.date * 1000) : undefined,
      })
    }

    return chats
  }

  /**
   * Check if we can export from a chat (admin log access)
   * @deprecated Use validateChatForExport for detailed validation
   */
  async canExportFromChat(chatId: bigint): Promise<boolean> {
    const result = await this.validateChatForExport(chatId)
    return result.canExport
  }

  /**
   * Validate a chat for export with detailed results
   * Returns structured information about why export may not be possible
   */
  async validateChatForExport(chatId: bigint): Promise<ChatValidationResult> {
    // Wait for any in-flight account initialization first.
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
      const client = await this.getConnectedClient()
      // @ts-expect-error - GramJS accepts bigint but types don't reflect it
      const entity = await client.getEntity(chatId)

      if (!entity) {
        return {
          valid: false,
          canExport: false,
          reason: 'not_found',
          errorMessage: 'Chat not found',
        }
      }

      const chatTitle = 'title' in entity ? entity.title : 'Unknown'
      const chatType = this.getEntityType(entity)

      // Admin logs only work for channels and supergroups
      if (!('broadcast' in entity || 'megagroup' in entity || 'gigagroup' in entity)) {
        return {
          valid: true,
          canExport: false,
          reason: 'not_channel',
          chatType,
          chatTitle,
          errorMessage: `Cannot export from ${chatType}. Admin logs are only available for channels and supergroups.`,
        }
      }

      // Check for admin rights
      const hasAdminRights = !!(entity as any).adminRights

      if (!hasAdminRights) {
        return {
          valid: true,
          canExport: false,
          reason: 'no_admin_rights',
          chatType,
          chatTitle,
          errorMessage: `You don't have admin rights in "${chatTitle}". Admin access is required to view deleted messages.`,
        }
      }

      // Try to actually access the admin log
      try {
        // @ts-expect-error - iterAdminLog exists but isn't in type definitions
        const adminLog = client.iterAdminLog(entity, { limit: 1 })
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _event of adminLog) {
          // Successfully accessed admin log
          break
        }
      } catch {
        return {
          valid: true,
          canExport: false,
          reason: 'no_admin_rights',
          chatType,
          chatTitle,
          errorMessage: `Cannot access admin log for "${chatTitle}". You may need "View Admin Log" permission.`,
        }
      }

      return {
        valid: true,
        canExport: true,
        chatType,
        chatTitle,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return {
        valid: false,
        canExport: false,
        reason: 'unknown_error',
        errorMessage: `Failed to validate chat: ${message}`,
      }
    }
  }

  private getEntityType(entity: unknown): string {
    if (!entity || typeof entity !== 'object') return 'unknown'

    if ('broadcast' in entity && (entity as any).broadcast) return 'channel'
    if ('megagroup' in entity && (entity as any).megagroup) return 'supergroup'
    if ('gigagroup' in entity) return 'supergroup'
    if ('title' in entity) return 'group'
    if ('firstName' in entity) return 'user'
    return 'chat'
  }

  /**
   * Iterate over deleted messages from admin log
   * Supports filtering by message ID range and limits
   *
   * @param chatId - Chat ID to fetch deleted messages from
   * @param options - Filtering options (minId, maxId, limit, minDate, maxDate)
   */
  async *iterDeletedMessages(
    chatId: bigint,
    options: AdminLogIterOptions = {}
  ): AsyncGenerator<DeletedMessage> {
    if (!this.client) {
      throw new Error('Client not connected')
    }

    // Validate chat first
    const validation = await this.validateChatForExport(chatId)
    if (!validation.canExport) {
      throw new Error(validation.errorMessage || 'Cannot export from this chat')
    }

    // @ts-expect-error - GramJS accepts bigint but types don't reflect it
    const entity = await this.client.getEntity(chatId)

    // Build admin log options
    const adminLogOptions: Record<string, unknown> = {
      delete: true,
    }

    if (options.minId !== undefined && options.minId > 0) {
      adminLogOptions.minId = options.minId
    }
    if (options.maxId !== undefined && options.maxId > 0) {
      adminLogOptions.maxId = options.maxId
    }
    if (options.limit !== undefined && options.limit > 0) {
      adminLogOptions.limit = options.limit
    }

    // Prepare date filters (convert to timestamps for comparison)
    const minTimestamp = options.minDate ? options.minDate.getTime() : null
    const maxTimestamp = options.maxDate ? options.maxDate.getTime() : null

    // @ts-expect-error - iterAdminLog exists but isn't in type definitions
    const adminLog = this.client.iterAdminLog(entity, adminLogOptions)

    for await (const event of adminLog) {
      if (!event.deletedMessage || !event.old) continue

      const msg = event.old

      // Apply date filtering
      const msgTimestamp = msg.date * 1000 // Convert to milliseconds

      // Skip messages before minDate
      if (minTimestamp !== null && msgTimestamp < minTimestamp) {
        continue
      }

      // Skip messages after maxDate
      if (maxTimestamp !== null && msgTimestamp > maxTimestamp) {
        continue
      }

      const mediaType = this.getMediaType(msg)

      // Extract media filename from document attributes if available
      let mediaFilename: string | undefined
      let mediaSize: number | undefined

      if (msg.media?.document) {
        const doc = msg.media.document
        mediaSize = doc.size
        const filenameAttr = doc.attributes?.find((a: any) => a._ === 'documentAttributeFilename')
        if (filenameAttr) {
          mediaFilename = filenameAttr.fileName
        }
      } else if (msg.media?.photo) {
        // For photos, generate a filename
        mediaFilename = `photo_${msg.id}.jpg`
      }

      yield {
        id: msg.id,
        chatId,
        senderId: msg.fromId ? BigInt((msg.fromId as any).userId?.toString() || '0') : undefined,
        text: msg.message || undefined,
        date: new Date(msg.date * 1000),
        hasMedia: !!msg.media,
        mediaType,
        mediaFilename,
        mediaSize,
        replyToMsgId: msg.replyTo?.replyToMsgId,
        replyToTopId: msg.replyTo?.replyToTopId,
        quoteText: msg.replyTo?.quoteText,
        // Preserve raw message for media download
        _rawMessage: msg.media ? msg : undefined,
      }
    }
  }

  private getMediaType(msg: any): MediaType | undefined {
    if (!msg.media) return undefined

    const media = msg.media
    if (media.photo) return 'photo'
    if (media.document) {
      const doc = media.document
      if (doc.mimeType?.startsWith('video/')) return 'video'
      if (doc.mimeType?.startsWith('audio/')) return 'audio'
      if (
        doc.mimeType?.includes('sticker') ||
        doc.attributes?.some((a: any) => a._ === 'documentAttributeSticker')
      )
        return 'sticker'
      if (doc.attributes?.some((a: any) => a._ === 'documentAttributeAnimated')) return 'animation'
      if (doc.attributes?.some((a: any) => a._ === 'documentAttributeVideo' && a.roundMessage))
        return 'videoNote'
      if (doc.attributes?.some((a: any) => a._ === 'documentAttributeAudio' && a.voice))
        return 'voice'
      return 'document'
    }
    if (media.poll) return 'poll'
    if (media.geo || media.geoLive) return 'location'
    if (media.contact) return 'contact'

    return undefined
  }

  /**
   * Download media from a message
   * Accepts either a raw GramJS message or a DeletedMessage with _rawMessage
   */
  async downloadMedia(msg: DeletedMessage | unknown): Promise<Blob | null> {
    const client = await this.getConnectedClient()

    // Handle DeletedMessage with preserved _rawMessage
    const rawMsg =
      msg && typeof msg === 'object' && '_rawMessage' in msg
        ? (msg as DeletedMessage)._rawMessage
        : msg

    if (!rawMsg || typeof rawMsg !== 'object' || !('media' in rawMsg) || !(rawMsg as any).media) {
      return null
    }

    try {
      const buffer = await client.downloadMedia(rawMsg as any, {})
      if (buffer) {
        // Handle both Buffer and string types from GramJS
        const data = typeof buffer === 'string' ? new TextEncoder().encode(buffer) : buffer
        return new Blob([data as BlobPart])
      }
    } catch (error) {
      console.error('Failed to download media:', error)
      throw error // Re-throw so retry logic can handle it
    }
    return null
  }

  /**
   * Download media from a DeletedMessage
   * Uses the preserved _rawMessage reference for accurate download
   */
  async downloadMessageMedia(message: DeletedMessage): Promise<Blob | null> {
    if (!message.hasMedia || !message._rawMessage) {
      return null
    }
    return this.downloadMedia(message._rawMessage)
  }

  /**
   * Get the underlying client (for advanced usage)
   */
  getClient(): TelegramClient | null {
    return this.client
  }

  /**
   * Get entity with caching to avoid redundant API calls
   * Matches Python's get_entity_cached pattern
   */
  async getEntityCached(entityId: bigint): Promise<unknown> {
    const cacheKey = entityId.toString()

    if (!this.entityCache.has(cacheKey)) {
      const client = await this.getConnectedClient()
      // @ts-expect-error - GramJS accepts bigint but types don't reflect it
      const entity = await client.getEntity(entityId)
      this.entityCache.set(cacheKey, entity)
    }

    return this.entityCache.get(cacheKey)
  }

  /**
   * Clear the entity cache
   */
  clearEntityCache(): void {
    this.entityCache.clear()
  }

  /**
   * Resolve sender info from entity
   */
  async resolveSenderInfo(senderId: bigint): Promise<{ name?: string; username?: string }> {
    try {
      const entity = await this.getEntityCached(senderId)
      if (!entity) return {}

      // Handle User entities
      if (entity && typeof entity === 'object' && 'firstName' in entity) {
        const user = entity as { firstName?: string; lastName?: string; username?: string }
        const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined
        return { name, username: user.username }
      }

      // Handle Channel entities
      if (entity && typeof entity === 'object' && 'title' in entity) {
        const channel = entity as { title?: string; username?: string }
        return { name: channel.title, username: channel.username }
      }

      return {}
    } catch {
      return {}
    }
  }

  /**
   * Check if user can send messages to a chat
   * Matches Python's can_send_to_chat pattern
   */
  async canSendToChat(chatId: bigint): Promise<boolean> {
    if (!this.client) return false

    try {
      // @ts-expect-error - GramJS accepts bigint but types don't reflect it
      const entity = await this.client.getEntity(chatId)
      if (!entity) return false

      // User chats - can always send
      if ('firstName' in entity) {
        return true
      }

      // For channels/groups, check permissions
      if ('broadcast' in entity && entity.broadcast) {
        // Broadcast channel - need post_messages right
        // @ts-expect-error - adminRights may exist
        return !!entity.adminRights?.postMessages
      }

      // For groups/supergroups, check if we can send
      // @ts-expect-error - defaultBannedRights may exist
      const banned = entity.defaultBannedRights
      if (banned && banned.sendMessages) {
        return false
      }

      return true
    } catch {
      return false
    }
  }

  /**
   * Send a message to a chat
   */
  async sendMessage(chatId: bigint, text: string, parseMode?: 'html' | 'md'): Promise<void> {
    if (!this.client) {
      throw new Error('Client not connected')
    }

    // @ts-expect-error - GramJS accepts bigint but types don't reflect it
    await this.client.sendMessage(chatId, {
      message: text,
      parseMode: parseMode,
      silent: true,
    })
  }

  /**
   * Send a file/media to a chat
   * Matches Python's client.send_file pattern
   */
  async sendFile(
    chatId: bigint,
    file: Blob | File,
    options: {
      caption?: string
      parseMode?: 'html' | 'md'
      forceDocument?: boolean
      filename?: string
    } = {}
  ): Promise<void> {
    if (!this.client) {
      throw new Error('Client not connected')
    }

    // Convert Blob to Buffer for GramJS
    const buffer = Buffer.from(await file.arrayBuffer())

    // Determine filename
    const filename = options.filename || (file instanceof File ? file.name : `file_${Date.now()}`)

    // @ts-expect-error - GramJS accepts bigint but types don't reflect it
    await this.client.sendFile(chatId, {
      file: buffer,
      caption: options.caption,
      parseMode: options.parseMode,
      forceDocument: options.forceDocument ?? false,
      silent: true,
      attributes: [
        new (await import('telegram/tl')).Api.DocumentAttributeFilename({
          fileName: filename,
        }),
      ],
    })
  }

  /**
   * Forward a message to a chat
   */
  async forwardMessage(fromChatId: bigint, toChatId: bigint, messageId: number): Promise<void> {
    if (!this.client) {
      throw new Error('Client not connected')
    }

    // @ts-expect-error - GramJS accepts bigint but types don't reflect it
    await this.client.forwardMessages(toChatId, {
      fromPeer: fromChatId,
      messages: [messageId],
    })
  }

  /**
   * Export session data for backup/migration
   * Returns an object that can be safely stored
   */
  exportSession(): { sessionString: string; apiId?: number; apiHash?: string } | null {
    const sessionString = this.session.save()
    if (!sessionString) return null

    return {
      sessionString,
      apiId: this.apiId ?? undefined,
      apiHash: this.apiHash ?? undefined,
    }
  }

  /**
   * Import session data from backup
   * @param data - Exported session data
   * @returns true if import was successful
   */
  importSession(data: { sessionString: string; apiId?: number; apiHash?: string }): boolean {
    try {
      this.session = new StringSession(data.sessionString)

      if (data.apiId && data.apiHash) {
        this.apiId = data.apiId
        this.apiHash = data.apiHash
      }

      return true
    } catch (error) {
      console.error('Failed to import session:', error)
      return false
    }
  }

  /**
   * Check if we have stored API credentials
   */
  hasStoredCredentials(): boolean {
    return this.apiId !== null && this.apiHash !== null
  }
}

// Singleton instance (with Playwright E2E hook)
// In E2E we inject `window.__MOCK_TELEGRAM__ = true` and `window.__mockTelegramService__`
// so the UI can run without real Telegram credentials.
declare global {
  // eslint-disable-next-line no-var
  var __MOCK_TELEGRAM__: boolean | undefined
  // eslint-disable-next-line no-var
  var __mockTelegramService__: unknown | undefined
}

const g = globalThis as any
const hasMockFlag = g.__MOCK_TELEGRAM__ === true
const hasMockService = !!g.__mockTelegramService__
const selectedMock = hasMockFlag && hasMockService

export const telegramService = (
  selectedMock ? g.__mockTelegramService__ : new TelegramService()
) as TelegramService
