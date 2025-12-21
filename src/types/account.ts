/**
 * Account type definitions for multi-account support
 */

export type AccountType = 'user' | 'bot'

export interface SavedAccount {
  id: string
  type: AccountType
  label: string // Display name: "John Doe" or "MyBot"
  username?: string // @username
  firstName?: string // First name from Telegram

  // User account specific
  phone?: string
  apiId?: number
  apiHash?: string

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

export interface AccountsState {
  accounts: SavedAccount[]
  activeAccountId: string | null
}

export interface AddUserAccountParams {
  phone: string
  apiId: number
  apiHash: string
}

export interface AddBotAccountParams {
  botToken: string
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
