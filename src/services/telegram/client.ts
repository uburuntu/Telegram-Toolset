/**
 * Telegram client wrapper around GramJS
 *
 * Uses the proper GramJS start() method with callbacks for authentication.
 * See: https://gram.js.org/getting-started/authorization
 */

import { Api, TelegramClient } from 'telegram'
import { StringSession } from 'telegram/sessions'
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
import { FloodWaitLogger } from './flood-wait-logger'
import { entityToPeerRef } from './peer-adapter'
import { resolveInputPeer } from './peer-input-resolver'

// Reconnection settings
const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 5
const MESSAGE_FETCH_BATCH_SIZE = 100

/**
 * GramJS resolves native `bigint` (and marked) peer ids at runtime, but its `EntityLike` parameter
 * type only lists the `big-integer` form and branded username/phone strings. Cast at the call
 * boundary so peer ids stay `bigint | string` in our code while the rest of each GramJS call (option
 * objects, message params, etc.) keeps full type-checking — a per-line `@ts-expect-error` would
 * silently suppress those too. Compile-time only: the value is returned unchanged.
 */
type PeerEntityArg = Parameters<TelegramClient['getInputEntity']>[0]
function toPeerEntityArg(id: bigint | string): PeerEntityArg {
  return id as unknown as PeerEntityArg
}

// Deferred promise helper for interactive auth flow
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
  phoneDeferred: DeferredPromise<string>
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

class TelegramService {
  private client: TelegramClient | null = null
  private session: StringSession
  private apiId: number | null = null
  private apiHash: string | null = null

  // Auth flow state
  private activeUserAuthAttempt: UserAuthAttempt | null = null
  private userAuthAttemptId = 0
  private currentUser: UserInfo | null = null

  // Entity cache for sender resolution (like Python's _entity_cache)
  private entityCache: Map<string, unknown> = new Map()

  // Connection state management
  private _connectionState: ConnectionState = 'disconnected'
  private reconnectAttempts = 0
  private connectionStateListeners: Set<(state: ConnectionState) => void> = new Set()

  // Flood wait event listeners
  private floodWaitListeners: Set<(seconds: number, method: string) => void> = new Set()

  // Race-free initialization orchestrator: if an account switch/init is in-flight, callers can await this.
  private _activeAccountInitPromise: Promise<boolean> | null = null
  private _activeAccountInitKey: string | null = null
  private _activeSessionAccountId: string | null = null
  private _accountTransitionGeneration = 0
  private _accountTransitionPromise: Promise<void> | null = null
  private _completeAccountTransition: (() => void) | null = null

  constructor() {
    // IMPORTANT: This service supports multiple accounts. We intentionally do NOT
    // read/write a single "global" session from localStorage here, because it causes
    // cross-account session leakage (e.g. adding a new phone instantly appears "logged in").
    //
    // The canonical session persistence is `SavedAccount.sessionString` inside `telegram_accounts`.
    this.session = new StringSession('')
  }

  private cancelInteractiveAuth(reason = 'AUTH_FLOW_CANCELLED'): void {
    const error = new Error(reason)
    const attempt = this.activeUserAuthAttempt
    if (!attempt) {
      return
    }

    attempt.phoneDeferred.reject(error)
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

  private async getActiveUserAccountId(): Promise<string | undefined> {
    try {
      const { useAccountsStore } = await import('@/stores/accounts')
      const accountsStore = useAccountsStore()
      const activeAccount = accountsStore.activeAccount
      return activeAccount?.type === 'user' ? activeAccount.id : undefined
    } catch {
      return undefined
    }
  }

  private getRecoverableAuthStage(error: unknown): RecoverableAuthStage | null {
    const message =
      typeof error === 'object' && error !== null
        ? (error as { errorMessage?: string; message?: string }).errorMessage ||
          (error as { errorMessage?: string; message?: string }).message ||
          ''
        : ''

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
    this.connectionStateListeners.forEach((listener) => {
      listener(state)
    })
  }

  /**
   * Subscribe to flood wait events from GramJS
   * Callback receives wait time in seconds and the API method that triggered it
   */
  onFloodWait(listener: (seconds: number, method: string) => void): () => void {
    this.floodWaitListeners.add(listener)
    return () => this.floodWaitListeners.delete(listener)
  }

  private emitFloodWait(seconds: number, method: string): void {
    this.floodWaitListeners.forEach((listener) => {
      listener(seconds, method)
    })
  }

  /**
   * Build the GramJS logger. It must be a real {@link Logger} (GramJS calls `canSend`/`_log` on it)
   * and we intercept flood-wait notices to drive UI countdowns.
   */
  private createCustomLogger(): FloodWaitLogger {
    return new FloodWaitLogger((message) => {
      // "Sleeping for Xs on flood wait (Caused by <method>)" — surface the wait to listeners.
      const floodMatch = message.match(/Sleeping for (\d+)s on flood wait \(Caused by ([^)]+)\)/)
      if (floodMatch) {
        const seconds = parseInt(floodMatch[1]!, 10)
        const method = floodMatch[2] || 'unknown'
        this.emitFloodWait(seconds, method)
      }
    })
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
      baseLogger: this.createCustomLogger(),
    })
  }

  /**
   * Connect and check if already authorized
   */
  async connect(accountId?: string): Promise<boolean> {
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
          await this.persistUserSession(accountId)
          this._activeSessionAccountId = accountId ?? (await this.getActiveUserAccountId()) ?? null
          this.setConnectionState('connected')
          return true
        }
      }

      this.currentUser = null
      this._activeSessionAccountId = null
      this.setConnectionState('disconnected')
      return false
    } catch (error) {
      // A thrown connect leaves no usable session. Release the socket and drop the client so a failed
      // attempt cannot linger as a half-open connection waiting for the next transition to clean it
      // up, while still reporting the honest 'error' typed state.
      try {
        await this.client?.disconnect()
      } catch {
        // Best-effort: the socket may already be unusable after the failed connect.
      }
      this.client = null
      this.currentUser = null
      this._activeSessionAccountId = null
      this.entityCache.clear()
      this.setConnectionState('error')
      throw error
    }
  }

  private async getConnectedClient(): Promise<TelegramClient> {
    // Wait for a synchronously installed account-transition barrier and the resulting init.
    await this.waitForActiveAccountInit()
    const expectedAccountId = await this.getActiveUserAccountId()
    if (!expectedAccountId) {
      throw new Error('An active Telegram user account is required.')
    }

    // Never let a newly-selected account reuse the previous account's still-connected client.
    if (!this.client || this._activeSessionAccountId !== expectedAccountId) {
      const restored = await this.tryRestoreSession()
      if (!restored || !this.client || this._activeSessionAccountId !== expectedAccountId) {
        await this.markActiveAccountNeedsLogin()
        throw new Error('Saved session could not be restored. Please log in again.')
      }
    }

    if (!this.client.connected) {
      const isAuthorized = await this.connect(await this.getActiveUserAccountId())
      if (!isAuthorized) {
        await this.disconnect()
        await this.markActiveAccountNeedsLogin()
        throw new Error('Saved session could not be restored. Please log in again.')
      }
      await this.markActiveAccountSessionReady()
    }
    if (!this.client) {
      await this.markActiveAccountNeedsLogin()
      throw new Error('Saved session could not be restored. Please log in again.')
    }
    return this.client
  }

  /**
   * Install a barrier synchronously when account-affine session state is about to change.
   * Gateway calls remain blocked until the latest transition token completes.
   */
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
    if (generation !== this._accountTransitionGeneration) {
      return
    }

    const complete = this._completeAccountTransition
    this._accountTransitionPromise = null
    this._completeAccountTransition = null
    complete?.()
  }

  /**
   * Record that the currently connected client belongs to this account.
   *
   * A fresh interactive login authenticates through `client.start()`, which
   * connects without going through `connect()` and therefore never stamps
   * session ownership. Without this, the next account-affine call would see a
   * mismatched owner and needlessly tear the just-authenticated session down to
   * rebuild it from the stored string.
   */
  markActiveUserSession(accountId: string): void {
    if (accountId) {
      this._activeSessionAccountId = accountId
    }
  }

  /**
   * Try to restore the session from stored account data.
   * This is called when the client is null but we may have credentials in localStorage.
   *
   * Uses lazy import of the accounts store to avoid circular dependencies.
   */
  private async tryRestoreSession(): Promise<boolean> {
    try {
      // Lazy import to avoid circular dependency (telegramService is created before Pinia stores)
      const { useAccountsStore } = await import('@/stores/accounts')
      const accountsStore = useAccountsStore()

      const activeAccount = accountsStore.activeAccount
      if (!activeAccount) {
        console.log('[TelegramService] No active account to restore')
        return false
      }

      // Only user accounts have session data we can restore
      if (activeAccount.type !== 'user') {
        console.log('[TelegramService] Active account is not a user account, cannot restore')
        return false
      }

      // Check we have the required credentials
      const creds = accountsStore.apiCredentials
      if (!activeAccount.sessionString || !creds) {
        console.log('[TelegramService] Missing credentials for session restoration')
        return false
      }

      console.log('[TelegramService] Attempting to restore session for:', activeAccount.label)

      // Use the existing method to restore the session
      const success = await this.useUserAccountSession({
        accountId: activeAccount.id,
        sessionString: activeAccount.sessionString,
        apiId: creds.apiId,
        apiHash: creds.apiHash,
      })

      if (success) {
        console.log('[TelegramService] Session restored successfully')
      } else {
        console.log('[TelegramService] Session restoration failed')
      }

      return success
    } catch (error) {
      console.error('[TelegramService] Error restoring session:', error)
      return false
    }
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
    accountId?: string
    sessionString: string
    apiId: number
    apiHash: string
  }): Promise<boolean> {
    const sessionKey = `${data.accountId ?? ''}:${data.apiId}:${data.sessionString}`

    while (this._activeAccountInitPromise) {
      if (this._activeAccountInitKey === sessionKey) {
        return this._activeAccountInitPromise
      }

      try {
        await this._activeAccountInitPromise
      } catch {
        // Ignore a failed previous switch and continue applying the requested account.
      }
    }

    const initPromise = (async () => {
      try {
        // A just-authenticated login already owns a live, connected client for
        // this account. Rebuilding it from the stored string only adds latency
        // and can bounce a fresh login to needs-login on a transient failure.
        if (
          data.accountId &&
          this.client?.connected &&
          this._activeSessionAccountId === data.accountId
        ) {
          await this.setAccountSessionState('ready', data.accountId)
          return true
        }

        await this.disconnect()
        this.currentUser = null
        this.entityCache.clear()
        this.session = new StringSession(data.sessionString || '')
        await this.initClient(data.apiId, data.apiHash)
        const isAuthorized = await this.connect(data.accountId)
        if (!isAuthorized) {
          await this.disconnect()
          await this.setAccountSessionState('needs_login', data.accountId)
        } else {
          await this.setAccountSessionState('ready', data.accountId)
        }
        return isAuthorized
      } finally {
        // Clear the promise once done so future switches can proceed.
        this._activeAccountInitPromise = null
        this._activeAccountInitKey = null
      }
    })()

    this._activeAccountInitKey = sessionKey
    this._activeAccountInitPromise = initPromise
    return initPromise
  }

  /**
   * Wait for any in-flight account initialization to complete.
   * Useful for APIs that need the client to be ready before proceeding.
   */
  async waitForActiveAccountInit(): Promise<void> {
    while (this._accountTransitionPromise || this._activeAccountInitPromise) {
      const transition = this._accountTransitionPromise
      if (transition) {
        await transition
        continue
      }

      const initialization = this._activeAccountInitPromise
      if (initialization) {
        await initialization
      }
    }
  }

  /**
   * Prepare for starting a brand-new user login flow (new phone).
   * Clears any existing session so we don't accidentally reuse another account's auth.
   */
  async resetForNewUserLogin(): Promise<void> {
    const pendingInit = this._activeAccountInitPromise
    if (pendingInit) {
      try {
        await pendingInit
      } catch {
        // Ignore failed restoration/account-switch attempts; we only need them finished.
      }
    }

    this._activeAccountInitPromise = null
    this._activeAccountInitKey = null

    await this.abortCurrentUserAuth()
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
    const delay = RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempts - 1)
    await new Promise((resolve) => setTimeout(resolve, delay))

    try {
      await this.initClient(this.apiId, this.apiHash)
      const result = await this.connect(await this.getActiveUserAccountId())
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
      const result = await this.connect(await this.getActiveUserAccountId())

      if (result) {
        this.setConnectionState('connected')
        await this.markActiveAccountSessionReady()
      } else {
        await this.disconnect()
        await this.markActiveAccountNeedsLogin()
        throw new Error('Saved session could not be restored. Please log in again.')
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
   *
   * @param phone - Phone number to authenticate
   * @param options - Optional callbacks for auth flow events
   * @param options.onPasswordNeeded - Called when 2FA password is required (with optional hint)
   */
  async startUserAuth(phone: string, options?: StartUserAuthOptions): Promise<UserInfo> {
    if (!this.client) {
      throw new Error('Client not initialized')
    }

    this.cancelInteractiveAuth()

    const attemptId = ++this.userAuthAttemptId
    const attempt: UserAuthAttempt = {
      id: attemptId,
      phoneDeferred: createDeferred<string>(),
      codeDeferred: null,
      passwordDeferred: null,
      onCodeNeeded: options?.onCodeNeeded || null,
      onPasswordNeeded: options?.onPasswordNeeded || null,
    }
    this.activeUserAuthAttempt = attempt

    // Resolve phone immediately since we already have it
    attempt.phoneDeferred.resolve(phone)

    try {
      await this.client.start({
        phoneNumber: async () => {
          return this.requireActiveUserAuthAttempt(attemptId).phoneDeferred.promise
        },
        phoneCode: async () => {
          const currentAttempt = this.requireActiveUserAuthAttempt(attemptId)
          currentAttempt.codeDeferred = createDeferred<string>()
          currentAttempt.passwordDeferred = null
          currentAttempt.onCodeNeeded?.()
          return currentAttempt.codeDeferred.promise
        },
        password: async (hint?: string) => {
          const currentAttempt = this.requireActiveUserAuthAttempt(attemptId)
          currentAttempt.passwordDeferred = createDeferred<string>()
          currentAttempt.codeDeferred = null
          // Notify UI that password is needed before waiting
          currentAttempt.onPasswordNeeded?.(hint)
          return currentAttempt.passwordDeferred.promise
        },
        onError: async (err) => {
          console.error('Auth error:', err)

          const recoverableStage = this.getRecoverableAuthStage(err)
          if (recoverableStage) {
            const currentAttempt = this.activeUserAuthAttempt
            if (currentAttempt?.id === attemptId) {
              if (recoverableStage === 'code') {
                currentAttempt.codeDeferred = null
              } else {
                currentAttempt.passwordDeferred = null
              }
            }
            options?.onRecoverableError?.(err, recoverableStage)
            return false
          }

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
      if (this.activeUserAuthAttempt?.id === attemptId) {
        this.cancelInteractiveAuth()
      }
    }
  }

  /**
   * Provide the verification code (called from UI)
   */
  provideCode(code: string): boolean {
    const attempt = this.activeUserAuthAttempt
    if (!attempt?.codeDeferred) {
      return false
    }

    const deferred = attempt.codeDeferred
    attempt.codeDeferred = null
    deferred.resolve(code)
    return true
  }

  /**
   * Provide the 2FA password (called from UI)
   */
  providePassword(password: string): boolean {
    const attempt = this.activeUserAuthAttempt
    if (!attempt?.passwordDeferred) {
      return false
    }

    const deferred = attempt.passwordDeferred
    attempt.passwordDeferred = null
    deferred.resolve(password)
    return true
  }

  async abortCurrentUserAuth(): Promise<void> {
    this.cancelInteractiveAuth()

    if (this.client) {
      try {
        await this.client.disconnect()
      } catch {
        // Ignore disconnect errors during best-effort auth cleanup.
      }
      this.client = null
    }

    this.currentUser = null
    // The client is gone, so no account owns the live session anymore. Leaving a
    // stale owner here lets a later login appear to belong to the previous account.
    this._activeSessionAccountId = null
    this.entityCache.clear()
    this.session = new StringSession('')
    this.setConnectionState('disconnected')
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
    this.cancelInteractiveAuth()
    try {
      if (this.client) {
        await this.client.disconnect()
      }
    } finally {
      this.client = null
      this.currentUser = null
      this._activeSessionAccountId = null
      this.entityCache.clear()
      this.setConnectionState('disconnected')
    }
  }

  /**
   * Logout and clear session
   */
  async logout(): Promise<void> {
    if (this.client) {
      try {
        await this.client.invoke(new Api.auth.LogOut())
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

  private async setAccountSessionState(
    state: 'ready' | 'needs_login',
    accountId?: string,
  ): Promise<void> {
    try {
      const { useAccountsStore } = await import('@/stores/accounts')
      const accountsStore = useAccountsStore()
      const targetAccountId = accountId ?? accountsStore.activeAccount?.id

      if (!targetAccountId) {
        return
      }

      const targetAccount = accountsStore.accounts.find((account) => account.id === targetAccountId)
      if (!targetAccount || targetAccount.type !== 'user') {
        return
      }

      if (state === 'ready') {
        accountsStore.markAccountSessionReady(targetAccountId)
      } else {
        accountsStore.markAccountNeedsLogin(targetAccountId)
      }
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
    const sessionString = this.session.save()
    if (!sessionString) {
      return
    }

    try {
      const { useAccountsStore } = await import('@/stores/accounts')
      const accountsStore = useAccountsStore()
      const targetAccountId = accountId ?? accountsStore.activeAccount?.id

      if (!targetAccountId) {
        return
      }

      const targetAccount = accountsStore.accounts.find((account) => account.id === targetAccountId)
      if (!targetAccount || targetAccount.type !== 'user') {
        return
      }

      if (targetAccount.sessionString === sessionString) {
        return
      }

      await accountsStore.updateAccount(targetAccount.id, { sessionString })
      accountsStore.markAccountSessionReady(targetAccount.id)
    } catch (error) {
      console.warn('[TelegramService] Failed to persist refreshed session:', error)
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
  async getDialogs(limit?: number): Promise<ChatInfo[]> {
    const client = await this.getConnectedClient()
    const dialogs = await client.getDialogs({ limit })
    const chats: ChatInfo[] = []

    for (const dialog of dialogs) {
      const entity = dialog.entity
      if (!entity) continue

      const id = BigInt(entity.id.toString())
      const peerId = this.getMarkedPeerId(entity)
      // Canonical reference captured at the dialog boundary so downstream storage/jobs carry the
      // access hash needed to rebuild an input peer after a cold start.
      const peerRef = entityToPeerRef(entity) ?? undefined
      let type: ChatInfo['type'] = 'user'
      let canExport = false

      // Check for admin rights or creator status
      const hasAdminRights = !!(entity as any).adminRights
      const isCreator = !!(entity as any).creator

      if ('broadcast' in entity && entity.broadcast) {
        type = 'channel'
        canExport = hasAdminRights || isCreator
      } else if ('megagroup' in entity && entity.megagroup) {
        type = 'supergroup'
        canExport = hasAdminRights || isCreator
      } else if ('gigagroup' in entity) {
        type = 'supergroup'
        canExport = hasAdminRights || isCreator
      } else if ('title' in entity) {
        type = 'group'
      }

      const canSend = this.canSendToEntity(entity)

      chats.push({
        id,
        peerId,
        peerRef,
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
        isAdmin: hasAdminRights || isCreator,
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
      const entity = await client.getEntity(toPeerEntityArg(chatId))

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

      // Check for admin rights or creator status
      const hasAdminRights = !!(entity as any).adminRights
      const isCreator = !!(entity as any).creator

      if (!hasAdminRights && !isCreator) {
        return {
          valid: true,
          canExport: false,
          reason: 'no_admin_rights',
          chatType,
          chatTitle,
          errorMessage: `You don't have admin rights in "${chatTitle}". Admin access is required to view deleted messages.`,
        }
      }

      // Try to actually access the admin log using the proper API
      try {
        // Get input channel for the API call
        const inputChannel = (await client.getInputEntity(
          entity,
        )) as unknown as Api.TypeInputChannel

        await client.invoke(
          new Api.channels.GetAdminLog({
            channel: inputChannel,
            q: '',
            maxId: 0 as unknown as Api.long,
            minId: 0 as unknown as Api.long,
            limit: 1,
            eventsFilter: new Api.ChannelAdminLogEventsFilter({
              delete: true,
            }),
          }),
        )
        // If we got here, admin log access is working
      } catch (adminLogError) {
        console.error('[TelegramService] Admin log access failed:', adminLogError)
        const errorDetail =
          adminLogError instanceof Error ? adminLogError.message : String(adminLogError)
        return {
          valid: true,
          canExport: false,
          reason: 'no_admin_rights',
          chatType,
          chatTitle,
          errorMessage: `Cannot access admin log for "${chatTitle}": ${errorDetail}`,
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

  private getMarkedPeerId(peer: unknown): string | undefined {
    if (!peer || typeof peer !== 'object') {
      return undefined
    }

    if ('userId' in peer) {
      const userId = peer.userId
      if (userId !== undefined && userId !== null) {
        return userId.toString()
      }
    }

    if ('chatId' in peer) {
      const chatId = peer.chatId
      if (chatId !== undefined && chatId !== null) {
        return `-${chatId.toString()}`
      }
    }

    if ('channelId' in peer) {
      const channelId = peer.channelId
      if (channelId !== undefined && channelId !== null) {
        return `-100${channelId.toString()}`
      }
    }

    if ('id' in peer) {
      const entityId = peer.id
      if (entityId === undefined || entityId === null) {
        return undefined
      }
      const id = entityId.toString()

      if (
        ('broadcast' in peer && !!(peer as { broadcast?: boolean }).broadcast) ||
        ('megagroup' in peer && !!(peer as { megagroup?: boolean }).megagroup) ||
        'gigagroup' in peer
      ) {
        return `-100${id}`
      }

      if ('title' in peer) {
        return `-${id}`
      }

      if ('firstName' in peer || 'lastName' in peer || 'username' in peer) {
        return id
      }
    }

    return undefined
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
    options: AdminLogIterOptions = {},
  ): AsyncGenerator<DeletedMessage> {
    // Validate chat first
    const validation = await this.validateChatForExport(chatId)
    if (!validation.canExport) {
      throw new Error(validation.errorMessage || 'Cannot export from this chat')
    }

    const client = await this.getConnectedClient()
    const entity = await client.getEntity(toPeerEntityArg(chatId))
    const inputChannel = await client.getInputEntity(entity)

    // Prepare date filters (convert to timestamps for comparison)
    const minTimestamp = options.minDate ? options.minDate.getTime() : null
    const maxTimestamp = options.maxDate ? options.maxDate.getTime() : null

    // Pagination state - use number for API compatibility
    let maxIdNum = options.maxId !== undefined ? options.maxId : 0
    const minIdNum = options.minId !== undefined ? options.minId : 0
    const batchLimit = 100 // Fetch 100 events per request
    let totalYielded = 0
    const maxTotal = options.limit ?? Infinity

    // Cast inputChannel for API call
    const typedInputChannel = inputChannel as unknown as Api.TypeInputChannel

    // Paginate through admin log
    while (totalYielded < maxTotal) {
      const result = await client.invoke(
        new Api.channels.GetAdminLog({
          channel: typedInputChannel,
          q: '',
          maxId: maxIdNum as unknown as Api.long,
          minId: minIdNum as unknown as Api.long,
          limit: Math.min(batchLimit, maxTotal - totalYielded),
          eventsFilter: new Api.ChannelAdminLogEventsFilter({
            delete: true,
          }),
        }),
      )

      const events = result.events
      if (!events || events.length === 0) {
        break // No more events
      }

      for (const event of events) {
        if (totalYielded >= maxTotal) break

        // Check if this is a delete event with the old message
        const action = event.action
        if (!(action instanceof Api.ChannelAdminLogEventActionDeleteMessage)) {
          continue
        }

        const msg = action.message
        if (!msg || !(msg instanceof Api.Message)) {
          continue
        }

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

        const mediaInfo = this.extractMediaInfo(msg)

        yield {
          id: msg.id,
          chatId,
          senderId:
            msg.fromId && 'userId' in msg.fromId ? BigInt(msg.fromId.userId.toString()) : undefined,
          text: msg.message || undefined,
          date: new Date(msg.date * 1000),
          ...mediaInfo,
          replyToMsgId:
            msg.replyTo && 'replyToMsgId' in msg.replyTo ? msg.replyTo.replyToMsgId : undefined,
          replyToTopId:
            msg.replyTo && 'replyToTopId' in msg.replyTo ? msg.replyTo.replyToTopId : undefined,
          quoteText: msg.replyTo && 'quoteText' in msg.replyTo ? msg.replyTo.quoteText : undefined,
          // Preserve raw message for media download
          _rawMessage: msg.media ? msg : undefined,
        }

        totalYielded++
      }

      // Update maxId for next page (use the last event's id)
      const lastEvent = events[events.length - 1]
      if (lastEvent) {
        // Convert BigInteger to number for next iteration
        maxIdNum = Number(lastEvent.id)
      }

      // If we got fewer events than requested, we've reached the end
      if (events.length < batchLimit) {
        break
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

  private extractMediaInfo(msg: Api.Message): {
    hasMedia: boolean
    mediaType?: MediaType
    mediaFilename?: string
    mediaSize?: number
    mediaMimeType?: string
  } {
    const mediaType = this.getMediaType(msg)
    let mediaFilename: string | undefined
    let mediaSize: number | undefined
    let mediaMimeType: string | undefined

    if (
      msg.media instanceof Api.MessageMediaDocument &&
      msg.media.document instanceof Api.Document
    ) {
      const doc = msg.media.document
      mediaSize = Number(doc.size)
      mediaMimeType = doc.mimeType || undefined
      const filenameAttr = doc.attributes?.find(
        (attribute): attribute is Api.DocumentAttributeFilename =>
          attribute instanceof Api.DocumentAttributeFilename,
      )
      if (filenameAttr?.fileName) {
        mediaFilename = filenameAttr.fileName
      }
    } else if (msg.media instanceof Api.MessageMediaPhoto && msg.media.photo) {
      mediaFilename = `photo_${msg.id}.jpg`
      mediaMimeType = 'image/jpeg'
    }

    return {
      hasMedia: !!msg.media,
      mediaType,
      mediaFilename,
      mediaSize,
      mediaMimeType,
    }
  }

  private getBlobMimeType(messageOrMedia: unknown): string | undefined {
    const media = messageOrMedia instanceof Api.Message ? messageOrMedia.media : messageOrMedia

    if (media instanceof Api.MessageMediaPhoto || media instanceof Api.Photo) {
      return 'image/jpeg'
    }

    if (media instanceof Api.MessageMediaDocument && media.document instanceof Api.Document) {
      return media.document.mimeType || undefined
    }

    if (media instanceof Api.Document) {
      return media.mimeType || undefined
    }

    if (media instanceof Api.MessageMediaContact) {
      return 'text/vcard'
    }

    if (media instanceof Api.MessageMediaWebPage && media.webpage instanceof Api.WebPage) {
      if (media.webpage.document instanceof Api.Document) {
        return media.webpage.document.mimeType || undefined
      }
      if (media.webpage.photo instanceof Api.Photo) {
        return 'image/jpeg'
      }
    }

    if (media instanceof Api.WebDocument || media instanceof Api.WebDocumentNoProxy) {
      return media.mimeType || undefined
    }

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
        const data =
          typeof buffer === 'string' ? new TextEncoder().encode(buffer) : new Uint8Array(buffer)
        if (data.byteLength === 0) {
          return null
        }

        const mimeType = this.getBlobMimeType(rawMsg)
        return mimeType
          ? new Blob([data as BlobPart], { type: mimeType })
          : new Blob([data as BlobPart])
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
   * Fetch full GramJS messages by ID so media can be downloaded on demand later.
   */
  async getChatMessagesByIds(
    chatId: bigint | string,
    messageIds: number[],
  ): Promise<Map<number, Api.Message>> {
    if (messageIds.length === 0) {
      return new Map()
    }

    const client = await this.getConnectedClient()

    const entity = await client.getEntity(toPeerEntityArg(chatId))
    const uniqueIds = Array.from(new Set(messageIds))
    const messages = new Map<number, Api.Message>()

    for (let index = 0; index < uniqueIds.length; index += MESSAGE_FETCH_BATCH_SIZE) {
      const chunk = uniqueIds.slice(index, index + MESSAGE_FETCH_BATCH_SIZE)
      const result = await client.getMessages(entity, { ids: chunk })

      for (const message of result) {
        if (message instanceof Api.Message) {
          messages.set(message.id, message)
        }
      }
    }

    return messages
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
  async getEntityCached(entityId: bigint | string): Promise<unknown> {
    const cacheKey = typeof entityId === 'bigint' ? entityId.toString() : entityId

    if (!this.entityCache.has(cacheKey)) {
      const client = await this.getConnectedClient()
      const entity = await client.getEntity(toPeerEntityArg(entityId))
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
  async resolveSenderInfo(
    senderId: bigint | string,
  ): Promise<{ name?: string; username?: string }> {
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
    try {
      const client = await this.getConnectedClient()
      const entity = await client.getEntity(toPeerEntityArg(chatId))
      if (!entity) return false
      return this.canSendToEntity(entity)
    } catch {
      return false
    }
  }

  private canSendToEntity(entity: unknown): boolean {
    if (!entity || typeof entity !== 'object') {
      return false
    }

    if ('firstName' in entity) {
      return true
    }

    if ('broadcast' in entity && entity.broadcast) {
      const channel = entity as { adminRights?: { postMessages?: boolean }; creator?: boolean }
      return !!channel.creator || !!channel.adminRights?.postMessages
    }

    const group = entity as { defaultBannedRights?: { sendMessages?: boolean } }
    if (group.defaultBannedRights?.sendMessages) {
      return false
    }

    return true
  }

  /**
   * Send a message to a chat
   */
  async sendMessage(chatId: bigint, text: string, parseMode?: 'html' | 'md'): Promise<void> {
    const client = await this.getConnectedClient()

    await client.sendMessage(toPeerEntityArg(chatId), {
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
    } = {},
  ): Promise<void> {
    const client = await this.getConnectedClient()

    // Convert Blob to Buffer for GramJS
    const buffer = Buffer.from(await file.arrayBuffer())

    // Determine filename
    const filename = options.filename || (file instanceof File ? file.name : `file_${Date.now()}`)

    await client.sendFile(toPeerEntityArg(chatId), {
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
    const client = await this.getConnectedClient()

    await client.forwardMessages(toPeerEntityArg(toChatId), {
      fromPeer: toPeerEntityArg(fromChatId),
      messages: [messageId],
    })
  }

  /**
   * Get all scheduled messages for a chat
   * Uses messages.GetScheduledHistory API
   */
  async getScheduledMessages(chatId: bigint): Promise<ScheduledMessage[]> {
    const client = await this.getConnectedClient()

    const entity = await client.getEntity(toPeerEntityArg(chatId))
    const inputPeer = await client.getInputEntity(entity)

    const result = await client.invoke(
      new Api.messages.GetScheduledHistory({
        peer: inputPeer,
        hash: BigInt(0) as unknown as Api.long,
      }),
    )

    const messages: ScheduledMessage[] = []

    // Handle different response types - guard against null/undefined messages
    // Some response types (like MessagesNotModified) don't have messages
    const msgList = 'messages' in result && Array.isArray(result.messages) ? result.messages : []

    for (const msg of msgList) {
      if (!(msg instanceof Api.Message)) continue

      // Scheduled messages have a special date field
      // The `date` field contains the scheduled send time
      const scheduledDate = new Date(msg.date * 1000)

      // editDate is when it was last edited, or creation time
      const date = msg.editDate ? new Date(msg.editDate * 1000) : scheduledDate

      const mediaInfo = this.extractMediaInfo(msg)

      messages.push({
        id: msg.id,
        chatId,
        text: msg.message || undefined,
        date,
        scheduledDate,
        ...mediaInfo,
        replyToMsgId:
          msg.replyTo && 'replyToMsgId' in msg.replyTo ? msg.replyTo.replyToMsgId : undefined,
        _rawMessage: msg.media ? msg : undefined,
      })
    }

    // Sort by scheduled date (soonest first)
    return messages.sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime())
  }

  /**
   * Delete scheduled messages from a chat
   * Uses messages.DeleteScheduledMessages API
   */
  async deleteScheduledMessages(chatId: bigint, messageIds: number[]): Promise<void> {
    if (messageIds.length === 0) return

    const client = await this.getConnectedClient()

    const entity = await client.getEntity(toPeerEntityArg(chatId))
    const inputPeer = await client.getInputEntity(entity)

    await client.invoke(
      new Api.messages.DeleteScheduledMessages({
        peer: inputPeer,
        id: messageIds,
      }),
    )
  }

  /**
   * Fetch one resumable page containing only messages authored by the active user.
   * Telegram performs the sender/date filtering server-side, so a trace scan does not download the
   * rest of a busy chat's history.
   */
  async searchOwnMessages(
    chatId: bigint | string,
    options: OwnMessageSearchOptions = {},
  ): Promise<OwnMessageSearchPage> {
    const client = await this.getConnectedClient()
    const entity = await client.getEntity(toPeerEntityArg(chatId))
    const inputPeer = await client.getInputEntity(entity)
    const self = await client.getInputEntity('me')
    const limit = Math.min(100, Math.max(1, options.limit ?? MESSAGE_FETCH_BATCH_SIZE))

    const result = await client.invoke(
      new Api.messages.Search({
        peer: inputPeer,
        q: '',
        fromId: self,
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: options.minDate ? Math.floor(options.minDate.getTime() / 1000) : 0,
        maxDate: options.maxDate ? Math.floor(options.maxDate.getTime() / 1000) : 0,
        offsetId: options.offsetId ?? 0,
        addOffset: 0,
        limit,
        maxId: 0,
        minId: 0,
        hash: BigInt(0) as unknown as Api.long,
      }),
    )

    if (result instanceof Api.messages.MessagesNotModified) {
      return { messages: [], total: result.count }
    }

    const rawMessages = result.messages
    const messages = rawMessages
      .filter((message): message is Api.Message => message instanceof Api.Message)
      .map((message) => ({
        id: message.id,
        date: new Date(message.date * 1000),
      }))
      .filter((message) => {
        if (options.minDate && message.date < options.minDate) return false
        if (options.maxDate && message.date > options.maxDate) return false
        return true
      })

    const lastMessage = rawMessages.at(-1)
    const nextOffsetId =
      rawMessages.length === limit && lastMessage && 'id' in lastMessage && lastMessage.id > 0
        ? lastMessage.id
        : undefined

    return {
      messages,
      total: 'count' in result ? result.count : rawMessages.length,
      nextOffsetId,
    }
  }

  /** Revoke a bounded message batch for every participant. Deletion is idempotent by message ID. */
  async deleteMessages(chatId: bigint | string, messageIds: number[]): Promise<void> {
    if (messageIds.length === 0) return

    const client = await this.getConnectedClient()
    const entity = await client.getEntity(toPeerEntityArg(chatId))
    await client.deleteMessages(entity, messageIds, { revoke: true })
  }

  /** Read back a deletion batch so an ambiguous transport failure can be reconciled. */
  async getExistingMessageIds(chatId: bigint | string, messageIds: number[]): Promise<number[]> {
    const messages = await this.getChatMessagesByIds(chatId, messageIds)
    return [...messages.keys()]
  }

  // =============================================================================
  // LLM Context Export - Chat History Methods
  // =============================================================================

  /**
   * Iterate over chat message history
   * Works for any chat the user is a member of (no admin rights required)
   * Uses GramJS iterMessages under the hood
   *
   * @param chatId - Chat ID to fetch messages from
   * @param options - Filtering options (limit, minDate, maxDate, reverse)
   */
  async *iterChatMessages(
    chatId: bigint | string,
    options: ChatHistoryOptions = {},
  ): AsyncGenerator<ChatMessage> {
    const client = await this.getConnectedClient()

    const entity = await client.getEntity(toPeerEntityArg(chatId))
    const rawChatId =
      entity && typeof entity === 'object' && 'id' in entity
        ? BigInt((entity as { id: { toString(): string } }).id.toString())
        : BigInt(String(chatId).replace(/^-100/, '').replace(/^-/, ''))
    const chatPeerId = this.getMarkedPeerId(entity)

    // Build iteration parameters
    const iterParams: Record<string, unknown> = {}

    if (options.limit !== undefined) {
      iterParams.limit = options.limit
    }
    if (options.offsetId !== undefined) {
      iterParams.offsetId = options.offsetId
    }
    if (options.reverse !== undefined) {
      iterParams.reverse = options.reverse
    }
    const offsetDate = options.reverse ? options.minDate : options.maxDate
    if (offsetDate !== undefined) {
      iterParams.offsetDate = Math.floor(offsetDate.getTime() / 1000)
    }

    // Use GramJS iterMessages helper
    for await (const msg of client.iterMessages(entity, iterParams)) {
      // Skip non-message types
      if (!(msg instanceof Api.Message)) continue

      const msgDate = new Date(msg.date * 1000)

      // GramJS source flips offsetDate semantics when reverse=true, so we use
      // it only as the nearest cursor and enforce the full closed range here.
      if (options.reverse) {
        if (options.minDate && msgDate < options.minDate) {
          continue
        }
        if (options.maxDate && msgDate > options.maxDate) {
          break
        }
      } else {
        if (options.maxDate && msgDate > options.maxDate) {
          continue
        }
        if (options.minDate && msgDate < options.minDate) {
          break
        }
      }

      const mediaInfo = this.extractMediaInfo(msg)

      // Extract sender info
      let senderId: bigint | undefined
      let senderPeerId: string | undefined
      let forwardedFrom: string | undefined

      if (msg.fromId && 'userId' in msg.fromId) {
        senderId = BigInt(msg.fromId.userId.toString())
        senderPeerId = this.getMarkedPeerId(msg.fromId)
      } else if (msg.fromId && 'chatId' in msg.fromId) {
        senderId = BigInt(msg.fromId.chatId.toString())
        senderPeerId = this.getMarkedPeerId(msg.fromId)
      } else if (msg.fromId && 'channelId' in msg.fromId) {
        senderId = BigInt(msg.fromId.channelId.toString())
        senderPeerId = this.getMarkedPeerId(msg.fromId)
      } else if (msg.peerId && 'userId' in msg.peerId) {
        senderId = BigInt(msg.peerId.userId.toString())
        senderPeerId = this.getMarkedPeerId(msg.peerId)
      }

      // Handle forwarded messages
      if (msg.fwdFrom) {
        if (msg.fwdFrom.fromName) {
          forwardedFrom = msg.fwdFrom.fromName
        } else if (msg.fwdFrom.fromId) {
          try {
            const forwardedPeerId = this.getMarkedPeerId(msg.fwdFrom.fromId)
            const fwdEntity = forwardedPeerId
              ? await this.getEntityCached(forwardedPeerId)
              : undefined
            if (fwdEntity && typeof fwdEntity === 'object') {
              if ('firstName' in fwdEntity) {
                forwardedFrom = [
                  (fwdEntity as { firstName?: string }).firstName,
                  (fwdEntity as { lastName?: string }).lastName,
                ]
                  .filter(Boolean)
                  .join(' ')
              } else if ('title' in fwdEntity) {
                forwardedFrom = (fwdEntity as { title?: string }).title
              }
            }
          } catch {
            // Ignore entity resolution errors for forwards
          }
        }
      }

      yield {
        id: msg.id,
        chatId: rawChatId,
        chatPeerId,
        senderId,
        senderPeerId,
        text: msg.message || undefined,
        date: msgDate,
        replyToMsgId:
          msg.replyTo && 'replyToMsgId' in msg.replyTo ? msg.replyTo.replyToMsgId : undefined,
        ...mediaInfo,
        forwardedFrom,
      }
    }
  }

  /**
   * Get total message count for a chat (approximate)
   * Useful for progress estimation
   */
  async getChatMessageCount(chatId: bigint | string | PeerRef): Promise<number> {
    const client = await this.getConnectedClient()

    // Warm path is unchanged; a stored PeerRef only adds a cold-start fallback.
    const inputPeer = (await resolveInputPeer(
      {
        getEntity: (id) => (client.getEntity as (value: unknown) => Promise<unknown>)(id),
        getInputEntity: (entity) =>
          (client.getInputEntity as (value: unknown) => Promise<unknown>)(entity),
      },
      chatId,
    )) as Api.TypeInputPeer

    const result = await client.invoke(
      new Api.messages.GetHistory({
        peer: inputPeer,
        offsetId: 0,
        offsetDate: 0,
        addOffset: 0,
        limit: 1,
        maxId: 0,
        minId: 0,
        hash: BigInt(0) as unknown as Api.long,
      }),
    )

    if ('count' in result) {
      return result.count
    }
    if ('messages' in result && Array.isArray(result.messages)) {
      return result.messages.length
    }
    return 0
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

  /**
   * Get full user info for the current user (extended profile data)
   */
  async getFullMe(): Promise<FullUserInfo | null> {
    const client = await this.getConnectedClient()

    try {
      const result = await client.invoke(
        new Api.users.GetFullUser({
          id: new Api.InputUserSelf(),
        }),
      )

      const fullUser = result.fullUser
      const user = result.users.find((u): u is Api.User => u instanceof Api.User && u.self === true)

      if (!user) return null

      return {
        id: BigInt(user.id.toString()),
        firstName: user.firstName || '',
        lastName: user.lastName || undefined,
        username: user.username || undefined,
        phone: user.phone || undefined,
        bio: fullUser.about || undefined,
        isPremium: !!user.premium,
        isVerified: !!user.verified,
        isRestricted: !!user.restricted,
        restrictionReason: user.restrictionReason?.map((r) => r.reason).join(', ') || undefined,
        commonChatsCount: fullUser.commonChatsCount || 0,
        // Profile photo metadata
        hasProfilePhoto: !!user.photo && user.photo.className !== 'UserProfilePhotoEmpty',
        dcId: user.photo && 'dcId' in user.photo ? user.photo.dcId : undefined,
      }
    } catch (error) {
      console.error('Failed to get full user info:', error)
      return null
    }
  }

  /**
   * Download profile photo for the current user
   * @returns Blob of the profile photo or null if none
   */
  async downloadMyProfilePhoto(): Promise<Blob | null> {
    const client = await this.getConnectedClient()

    try {
      // Download profile photo using GramJS helper
      const buffer = await client.downloadProfilePhoto('me', {
        isBig: true, // Get the high-resolution version
      })

      if (!buffer || buffer.length === 0) {
        return null
      }

      // Convert Buffer to Blob - handle both string and Buffer/Uint8Array
      const data =
        typeof buffer === 'string' ? new TextEncoder().encode(buffer) : new Uint8Array(buffer)
      return new Blob([data], { type: 'image/jpeg' })
    } catch (error) {
      console.error('Failed to download profile photo:', error)
      return null
    }
  }

  /**
   * Get account statistics - number of dialogs, contacts, etc.
   */
  async getAccountStats(): Promise<AccountStats> {
    const client = await this.getConnectedClient()

    try {
      // Get dialogs count
      const dialogs = await client.getDialogs({ limit: 1 })
      const totalDialogs = dialogs.total || 0

      // Get contacts count
      const contacts = await client.invoke(
        new Api.contacts.GetContacts({ hash: BigInt(0) as unknown as Api.long }),
      )
      const contactsCount =
        contacts.className === 'contacts.Contacts' ? contacts.contacts.length : 0

      // Get blocked users count
      const blocked = await client.invoke(new Api.contacts.GetBlocked({ offset: 0, limit: 1 }))
      const blockedCount = 'count' in blocked ? blocked.count : blocked.users?.length || 0

      return {
        dialogsCount: totalDialogs,
        contactsCount,
        blockedCount,
      }
    } catch (error) {
      console.error('Failed to get account stats:', error)
      return {
        dialogsCount: 0,
        contactsCount: 0,
        blockedCount: 0,
      }
    }
  }
}

/**
 * Extended user info from users.GetFullUser
 */
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
  hasProfilePhoto: boolean
  dcId?: number
}

/**
 * Account statistics
 */
export interface AccountStats {
  dialogsCount: number
  contactsCount: number
  blockedCount: number
}

// Singleton instance (with Playwright E2E hook)
// In E2E we inject `window.__MOCK_TELEGRAM__ = true` and `window.__mockTelegramService__`
// so the UI can run without real Telegram credentials.
declare global {
  var __MOCK_TELEGRAM__: boolean | undefined

  var __mockTelegramService__: unknown | undefined
}

const g = globalThis as any
const hasMockFlag = g.__MOCK_TELEGRAM__ === true
const hasMockService = !!g.__mockTelegramService__
const selectedMock = hasMockFlag && hasMockService

export const telegramService = (
  selectedMock ? g.__mockTelegramService__ : new TelegramService()
) as TelegramService
