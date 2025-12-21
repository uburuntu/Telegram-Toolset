/**
 * Type definitions for GramJS admin log and related operations
 * These extend the base GramJS types with missing method signatures
 */

import type { TelegramClient } from 'telegram'

/**
 * Admin log event from GramJS
 */
export interface AdminLogEvent {
  id: number
  date: number
  userId: bigint

  // Action type indicators
  deletedMessage?: boolean
  editedMessage?: boolean
  joinedByInvite?: boolean
  // ... other action types

  // The original/old message (for deleted/edited)
  old?: GramJSMessage

  // The new message (for edited)
  new?: GramJSMessage
}

/**
 * GramJS Message object (simplified)
 */
export interface GramJSMessage {
  id: number
  date: number
  message?: string
  fromId?: {
    _: string
    userId?: bigint
    channelId?: bigint
    chatId?: bigint
  }
  media?: GramJSMedia
  replyTo?: {
    replyToMsgId?: number
    replyToTopId?: number
    quoteText?: string
  }
}

/**
 * GramJS Media types
 */
export interface GramJSMedia {
  _: string
  photo?: GramJSPhoto
  document?: GramJSDocument
  poll?: unknown
  geo?: unknown
  geoLive?: unknown
  contact?: unknown
}

export interface GramJSPhoto {
  id: bigint
  accessHash: bigint
  fileReference: Uint8Array
  date: number
  sizes: unknown[]
}

export interface GramJSDocument {
  id: bigint
  accessHash: bigint
  fileReference: Uint8Array
  date: number
  mimeType?: string
  size: number
  attributes?: GramJSDocumentAttribute[]
}

export type GramJSDocumentAttribute =
  | { _: 'documentAttributeFilename'; fileName: string }
  | { _: 'documentAttributeVideo'; roundMessage?: boolean; duration: number; w: number; h: number }
  | { _: 'documentAttributeAudio'; voice?: boolean; duration: number; title?: string }
  | { _: 'documentAttributeSticker'; alt: string }
  | { _: 'documentAttributeAnimated' }
  | { _: 'documentAttributeImageSize'; w: number; h: number }

/**
 * Options for iterAdminLog
 */
export interface IterAdminLogOptions {
  limit?: number
  minId?: number
  maxId?: number

  // Action filters (only one can be true)
  delete?: boolean
  edit?: boolean
  join?: boolean
  leave?: boolean
  invite?: boolean
  promote?: boolean
  demote?: boolean
  ban?: boolean
  unban?: boolean
  // ... other filters
}

/**
 * Extended TelegramClient interface with admin log methods
 */
export interface ExtendedTelegramClient extends TelegramClient {
  /**
   * Iterate over admin log events
   */
  iterAdminLog(entity: unknown, options?: IterAdminLogOptions): AsyncGenerator<AdminLogEvent>

  /**
   * Get entity by ID (supports bigint)
   */
  getEntity(id: bigint | number | string): Promise<unknown>
}

/**
 * Channel entity type
 */
export interface ChannelEntity {
  _: 'Channel'
  id: bigint
  title: string
  username?: string
  broadcast?: boolean
  megagroup?: boolean
  gigagroup?: boolean
  adminRights?: AdminRights
  defaultBannedRights?: ChatBannedRights
}

/**
 * User entity type
 */
export interface UserEntity {
  _: 'User'
  id: bigint
  firstName?: string
  lastName?: string
  username?: string
  phone?: string
}

/**
 * Chat entity type (basic groups)
 */
export interface ChatEntity {
  _: 'Chat'
  id: bigint
  title: string
}

/**
 * Admin rights
 */
export interface AdminRights {
  changeInfo?: boolean
  postMessages?: boolean
  editMessages?: boolean
  deleteMessages?: boolean
  banUsers?: boolean
  inviteUsers?: boolean
  pinMessages?: boolean
  addAdmins?: boolean
  anonymous?: boolean
  manageCall?: boolean
  other?: boolean
}

/**
 * Banned rights
 */
export interface ChatBannedRights {
  viewMessages?: boolean
  sendMessages?: boolean
  sendMedia?: boolean
  sendStickers?: boolean
  sendGifs?: boolean
  sendGames?: boolean
  sendInline?: boolean
  embedLinks?: boolean
  sendPolls?: boolean
  changeInfo?: boolean
  inviteUsers?: boolean
  pinMessages?: boolean
  untilDate?: number
}
