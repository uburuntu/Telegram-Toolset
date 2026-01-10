/**
 * Telegram-related type definitions
 */

export interface ChatInfo {
  id: bigint
  title: string
  type: 'channel' | 'supergroup' | 'group' | 'user'
  username?: string
  participantCount?: number
  canExport: boolean
  canSend: boolean
  /** Whether the current user is admin/creator in this chat */
  isAdmin: boolean
  lastMessageDate?: Date
}

export interface UserInfo {
  id: bigint
  firstName: string
  lastName?: string
  username?: string
  phone?: string
}

export type MediaType =
  | 'photo'
  | 'video'
  | 'document'
  | 'sticker'
  | 'voice'
  | 'videoNote'
  | 'audio'
  | 'animation'
  | 'poll'
  | 'location'
  | 'contact'

export interface MediaDownloadResult {
  type: MediaType
  blob: Blob
  filename: string
  mimeType: string
  size: number
  thumbnail?: Blob
  duration?: number
  dimensions?: { width: number; height: number }
}

export interface DeletedMessage {
  id: number
  chatId: bigint
  senderId?: bigint
  senderName?: string
  senderUsername?: string
  text?: string
  date: Date
  hasMedia: boolean
  mediaType?: MediaType
  mediaFilename?: string
  mediaSize?: number
  replyToMsgId?: number
  replyToTopId?: number
  quoteText?: string
  /** Raw GramJS message object for media download - not serialized */
  _rawMessage?: unknown
}

/**
 * A scheduled message waiting to be sent
 */
export interface ScheduledMessage {
  id: number
  chatId: bigint
  chatTitle?: string
  text?: string
  /** Date when the message was created/edited */
  date: Date
  /** Date when the message is scheduled to be sent */
  scheduledDate: Date
  hasMedia: boolean
  mediaType?: MediaType
  mediaFilename?: string
  mediaSize?: number
  replyToMsgId?: number
  /** Raw GramJS message object for media download - not serialized */
  _rawMessage?: unknown
}

/**
 * Options for iterating deleted messages from admin log
 */
export interface AdminLogIterOptions {
  /** Minimum message ID (exclusive) - start after this ID */
  minId?: number
  /** Maximum message ID (exclusive) - stop before this ID */
  maxId?: number
  /** Maximum number of events to fetch */
  limit?: number
  /** Minimum date (inclusive) - only messages on or after this date */
  minDate?: Date
  /** Maximum date (inclusive) - only messages on or before this date */
  maxDate?: Date
}

/**
 * Result of chat validation for export
 */
export interface ChatValidationResult {
  valid: boolean
  canExport: boolean
  reason?: 'not_channel' | 'no_admin_rights' | 'not_found' | 'unknown_error'
  chatType?: string
  chatTitle?: string
  errorMessage?: string
}

/**
 * Connection state for Telegram client
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface AuthState {
  status:
    | 'disconnected'
    | 'connecting'
    | 'awaiting_phone'
    | 'awaiting_code'
    | 'awaiting_password'
    | 'authorized'
  phone?: string
  codeHash?: string
  user?: UserInfo
  error?: string
}

export interface TelegramConfig {
  apiId: number
  apiHash: string
}
