/**
 * Telegram client wrapper around GramJS
 *
 * Uses the proper GramJS start() method with callbacks for authentication.
 * See: https://gram.js.org/getting-started/authorization
 */

import { TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
import type { UserInfo, ChatInfo, DeletedMessage, MediaType } from '@/types'

const SESSION_KEY = 'telegram_session'

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

  // Auth flow state
  private phoneDeferred: DeferredPromise<string> | null = null
  private codeDeferred: DeferredPromise<string> | null = null
  private passwordDeferred: DeferredPromise<string> | null = null
  private currentUser: UserInfo | null = null

  constructor() {
    const savedSession = localStorage.getItem(SESSION_KEY) || ''
    this.session = new StringSession(savedSession)
  }

  get isConnected(): boolean {
    return this.client?.connected ?? false
  }

  get user(): UserInfo | null {
    return this.currentUser
  }

  /**
   * Initialize client with API credentials
   */
  async initClient(apiId: number, apiHash: string): Promise<void> {
    // Store credentials for potential reconnection (unused currently)

    this.client = new TelegramClient(this.session, apiId, apiHash, {
      connectionRetries: 5,
      useWSS: true,
    })
  }

  /**
   * Connect and check if already authorized
   */
  async connect(): Promise<boolean> {
    if (!this.client) {
      throw new Error('Client not initialized. Call initClient first.')
    }

    await this.client.connect()

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
        return true
      }
    }

    return false
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

    localStorage.removeItem(SESSION_KEY)
    this.session = new StringSession('')
  }

  private saveSession(): void {
    const sessionString = this.session.save()
    if (sessionString) {
      localStorage.setItem(SESSION_KEY, sessionString)
    }
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
    if (!this.client) {
      throw new Error('Client not connected')
    }

    const dialogs = await this.client.getDialogs({ limit })
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
   */
  async canExportFromChat(chatId: bigint): Promise<boolean> {
    if (!this.client) return false

    try {
      // @ts-expect-error - GramJS accepts bigint but types don't reflect it
      const entity = await this.client.getEntity(chatId)
      if (!entity || !('adminRights' in entity)) return false

      // @ts-expect-error - iterAdminLog exists but isn't in type definitions
      const adminLog = this.client.iterAdminLog(entity, { limit: 1 })
      for await (const _ of adminLog) {
        return true
      }
      return true
    } catch {
      return false
    }
  }

  /**
   * Iterate over deleted messages from admin log
   */
  async *iterDeletedMessages(chatId: bigint): AsyncGenerator<DeletedMessage> {
    if (!this.client) {
      throw new Error('Client not connected')
    }

    // @ts-expect-error - GramJS accepts bigint but types don't reflect it
    const entity = await this.client.getEntity(chatId)
    // @ts-expect-error - iterAdminLog exists but isn't in type definitions
    const adminLog = this.client.iterAdminLog(entity, {
      delete: true,
    })

    for await (const event of adminLog) {
      if (!event.deletedMessage || !event.old) continue

      const msg = event.old
      const mediaType = this.getMediaType(msg)

      yield {
        id: msg.id,
        chatId,
        senderId: msg.fromId ? BigInt((msg.fromId as any).userId?.toString() || '0') : undefined,
        text: msg.message || undefined,
        date: new Date(msg.date * 1000),
        hasMedia: !!msg.media,
        mediaType,
        replyToMsgId: msg.replyTo?.replyToMsgId,
        replyToTopId: msg.replyTo?.replyToTopId,
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
   */
  async downloadMedia(msg: any): Promise<Blob | null> {
    if (!this.client || !msg.media) return null

    try {
      const buffer = await this.client.downloadMedia(msg, {})
      if (buffer) {
        // Handle both Buffer and string types from GramJS
        const data = typeof buffer === 'string' ? new TextEncoder().encode(buffer) : buffer
        return new Blob([data as BlobPart])
      }
    } catch (error) {
      console.error('Failed to download media:', error)
    }
    return null
  }

  /**
   * Get the underlying client (for advanced usage)
   */
  getClient(): TelegramClient | null {
    return this.client
  }
}

// Singleton instance
export const telegramService = new TelegramService()
