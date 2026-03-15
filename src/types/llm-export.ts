/**
 * LLM Context Export type definitions
 *
 * Types for exporting chat history in formats optimized for LLM consumption.
 * Separates data acquisition (slow, network-bound) from formatting (fast, local).
 */

import type { MediaType } from './telegram'

/**
 * A single chat message for LLM export
 * Simplified compared to DeletedMessage - focused on text content for LLM context
 */
export interface ChatMessage {
  id: number
  chatId: bigint
  senderId?: bigint
  /** Sender name (may be contact name from your contacts) */
  senderName?: string
  /** Sender's original Telegram display name (peer's own name) */
  senderOriginalName?: string
  senderUsername?: string
  text?: string
  date: Date
  replyToMsgId?: number
  hasMedia: boolean
  mediaType?: MediaType
  /** For forwarded messages */
  forwardedFrom?: string
}

/**
 * Metadata for a cached chat export
 */
export interface ChatExport {
  id: string
  chatId: bigint
  chatTitle: string
  chatType: 'channel' | 'supergroup' | 'group' | 'user'
  createdAt: Date
  messageCount: number
  /** Date range of messages in the export */
  dateRange: {
    from: Date
    to: Date
  }
  /** Optional user-defined label */
  label?: string
}

/**
 * Format template types
 */
export type FormatTemplate = 'xml' | 'plain' | 'json' | 'markdown' | 'custom'

/**
 * Date format options
 */
export type DateFormatOption = 'iso' | 'short' | 'long' | 'time-only' | 'none'

/**
 * Date grouping options for token optimization
 */
export type DateGroupingOption = 'per-message' | 'per-day'

/**
 * How to handle media in the formatted output
 */
export type MediaPlaceholderOption = 'skip' | 'bracket' | 'emoji'

/**
 * Configuration for formatting chat messages
 */
export interface FormatConfig {
  /** Output format template */
  template: FormatTemplate
  /** Custom template string (only used when template is 'custom') */
  customTemplate?: string

  /** Include message dates */
  includeDate: boolean
  /** Date format style */
  dateFormat: DateFormatOption
  /** How to group dates (per-message or per-day for token savings) */
  dateGrouping: DateGroupingOption

  /** Include sender display name */
  includeSenderName: boolean
  /** Include sender @username */
  includeSenderUsername: boolean
  /** Use peer's original Telegram name instead of contact names */
  useOriginalSenderNames: boolean
  /** Include reply-to context */
  includeReplyContext: boolean
  /** Include message IDs */
  includeMessageIds: boolean

  /** How to represent media messages */
  mediaPlaceholder: MediaPlaceholderOption

  /** Limit number of messages in output (0 = no limit) */
  messageLimit: number
  /** Reverse order (oldest first vs newest first) */
  reverseOrder: boolean

  /** Filter by date range (applied to cached data) */
  filterDateRange?: {
    from?: Date
    to?: Date
  }
}

/**
 * Default format configuration
 */
export const DEFAULT_FORMAT_CONFIG: FormatConfig = {
  template: 'plain',
  includeDate: true,
  dateFormat: 'short',
  dateGrouping: 'per-message',
  includeSenderName: true,
  includeSenderUsername: false,
  useOriginalSenderNames: false,
  includeReplyContext: true,
  includeMessageIds: false,
  mediaPlaceholder: 'bracket',
  messageLimit: 0,
  reverseOrder: true, // oldest first is usually better for LLM context
}

/**
 * Options for downloading chat history
 */
export interface ChatHistoryOptions {
  /** Maximum number of messages to fetch */
  limit?: number
  /** Minimum date (fetch messages on or after this date) */
  minDate?: Date
  /** Maximum date (fetch messages on or before this date) */
  maxDate?: Date
  /** Offset message ID for pagination */
  offsetId?: number
  /** Reverse order (oldest first) */
  reverse?: boolean
}

/**
 * Progress tracking for chat history download
 */
export interface ChatHistoryProgress {
  phase: 'initializing' | 'fetching' | 'saving' | 'complete' | 'error' | 'cancelled'
  fetchedMessages: number
  totalEstimate?: number
  currentMessageId?: number
  errorMessage?: string
  startTime: Date
}

/**
 * Callbacks for chat history download
 */
export interface ChatHistoryCallbacks {
  onProgress?: (progress: ChatHistoryProgress) => void
  onMessage?: (message: ChatMessage) => void
  onError?: (error: Error) => void
  /** Called when a FloodWait error occurs with the wait time in seconds */
  onFloodWait?: (seconds: number) => void
  /** Called with remaining seconds during FloodWait countdown */
  onFloodWaitCountdown?: (remainingSeconds: number) => void
}

/**
 * Result of chat history download
 */
export interface ChatHistoryResult {
  messages: ChatMessage[]
  chatExport: ChatExport
}

/**
 * Saved format preset
 */
export interface FormatPreset {
  id: string
  name: string
  config: FormatConfig
  createdAt: Date
}
