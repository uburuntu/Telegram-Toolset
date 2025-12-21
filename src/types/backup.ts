/**
 * Backup management type definitions
 */

import type { DeletedMessage } from './telegram'

export interface MediaTypeStats {
  photos: number
  videos: number
  documents: number
  stickers: number
  voiceMessages: number
  videoNotes: number
  audio: number
  gifs: number
}

export interface Backup {
  id: string
  chatId: bigint
  chatTitle: string
  chatType: 'channel' | 'supergroup' | 'group' | 'user'
  createdAt: Date
  messageCount: number
  mediaCount: number
  storageSize: number
  hasMedia: boolean
  mediaTypes: MediaTypeStats
  exportMode: 'all' | 'media_only' | 'text_only'
}

export interface BackupWithMessages extends Backup {
  messages: DeletedMessage[]
  mediaBlobs: Map<number, Blob>
}

export interface ExportProgress {
  phase:
    | 'initializing'
    | 'fetching_metadata'
    | 'downloading_media'
    | 'saving'
    | 'complete'
    | 'error'
    | 'cancelled'
  totalMessages: number
  processedMessages: number
  exportedTextMessages: number
  exportedMediaMessages: number
  failedMessages: number
  currentMessageId?: number
  errorMessage?: string
  startTime: Date
  estimatedBytesTotal?: number
  downloadedBytes?: number
}

export interface ExportConfig {
  chatId: bigint
  chatTitle: string
  exportMode: 'all' | 'media_only' | 'text_only'
  storageStrategy: 'indexeddb' | 'stream_download' | 'metadata_only'
}

export interface ResendConfig {
  targetChatId: bigint
  targetChatTitle: string
  backupId: string
  includeMedia: boolean
  includeText: boolean
  showSenderName: boolean
  showSenderUsername: boolean
  showDate: boolean
  showReplyLink: boolean
  useHiddenReplyLinks: boolean
  timezoneOffsetHours: number
  enableBatching: boolean
  batchMaxMessages: number
  batchTimeWindowMinutes: number
  batchMaxMessageLength: number
}

export interface StorageEstimate {
  used: number
  available: number
  percentUsed: number
}

export interface StorageCheckResult {
  canStore: boolean
  reason?: 'quota_exceeded' | 'low_space_warning'
  suggestedAction?: 'delete_old' | 'download_instead' | 'metadata_only'
}

export type ExportStrategy = {
  type: 'indexeddb' | 'stream_download'
  storeMedia: boolean
  storeMetadataOnly?: boolean
  warnUser?: boolean
}
