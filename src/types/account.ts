/**
 * Account type definitions for multi-account support
 */

import type { TelegramPrincipal } from './principal'

export type AccountType = 'user' | 'bot'

/**
 * Telegram API credentials (app-level, shared across all user accounts).
 * Obtained from https://my.telegram.org/auth
 */
export interface ApiCredentials {
  apiId: number
  apiHash: string
}

export interface SavedAccount {
  id: string
  type: AccountType
  label: string // Display name: "John Doe" or "MyBot"
  username?: string // @username
  firstName?: string // First name from Telegram

  /**
   * Stable Telegram identity for this account. The local `id` is only an installation-scoped
   * record key; `principal` is the durable authority used for ownership and re-login matching.
   * Optional for backward compatibility with accounts saved before this field existed; it is
   * backfilled on the next successful authentication.
   */
  principal?: TelegramPrincipal

  // User account specific
  phone?: string

  // Bot account specific
  botToken?: string
  botTelegramId?: number // Telegram's user ID for the bot (for duplicate detection)
  canJoinGroups?: boolean
  canReadAllGroupMessages?: boolean
  supportsInlineQueries?: boolean
  hasMainWebApp?: boolean

  // Session data
  sessionString: string

  // Metadata
  createdAt: Date
  lastUsedAt: Date
}
