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
}

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
