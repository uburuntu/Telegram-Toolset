/**
 * Account type definitions for multi-account support
 */

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

export interface AuthFlowState {
  step: 'idle' | 'phone' | 'code' | 'password' | 'bot_token' | 'complete' | 'error'
  accountType: AccountType
  phone?: string
  phoneCodeHash?: string
  apiId?: number
  apiHash?: string
  error?: string
}
