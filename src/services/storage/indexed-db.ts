/**
 * IndexedDB operations using idb library
 */

import { openDB, type IDBPDatabase } from 'idb'
import type { Backup, DeletedMessage, MediaTypeStats, ChatExport, ChatMessage } from '@/types'
import { stripRawMessage, safeJsonStringify } from '@/utils/message-serialization'

interface TelegramToolsetDB {
  backups: {
    key: string
    value: Backup
    indexes: {
      'by-chat': bigint
      'by-date': Date
    }
  }
  messages: {
    key: [string, number] // [backupId, messageId]
    value: DeletedMessage & { backupId: string }
    indexes: {
      'by-backup': string
    }
  }
  media: {
    key: [string, number] // [backupId, messageId]
    value: {
      backupId: string
      messageId: number
      blob: Blob
      filename: string
      mimeType: string
    }
    indexes: {
      'by-backup': string
    }
  }
  // LLM Context Export stores
  chatExports: {
    key: string
    value: ChatExport
    indexes: {
      'by-chat': bigint
      'by-date': Date
    }
  }
  chatMessages: {
    key: [string, number] // [exportId, messageId]
    value: ChatMessage & { exportId: string }
    indexes: {
      'by-export': string
    }
  }
}

const DB_NAME = 'telegram-toolset'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<TelegramToolsetDB>> | null = null

async function getDB(): Promise<IDBPDatabase<TelegramToolsetDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TelegramToolsetDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Version 1: Original schema
        if (oldVersion < 1) {
          // Backups store
          if (!db.objectStoreNames.contains('backups')) {
            const backupStore = db.createObjectStore('backups', { keyPath: 'id' })
            backupStore.createIndex('by-chat', 'chatId')
            backupStore.createIndex('by-date', 'createdAt')
          }

          // Messages store
          if (!db.objectStoreNames.contains('messages')) {
            const messageStore = db.createObjectStore('messages', { keyPath: ['backupId', 'id'] })
            messageStore.createIndex('by-backup', 'backupId')
          }

          // Media store
          if (!db.objectStoreNames.contains('media')) {
            const mediaStore = db.createObjectStore('media', { keyPath: ['backupId', 'messageId'] })
            mediaStore.createIndex('by-backup', 'backupId')
          }
        }

        // Version 2: LLM Context Export stores
        if (oldVersion < 2) {
          // Chat exports store (metadata)
          if (!db.objectStoreNames.contains('chatExports')) {
            const exportsStore = db.createObjectStore('chatExports', { keyPath: 'id' })
            exportsStore.createIndex('by-chat', 'chatId')
            exportsStore.createIndex('by-date', 'createdAt')
          }

          // Chat messages store (for LLM export)
          if (!db.objectStoreNames.contains('chatMessages')) {
            const chatMsgStore = db.createObjectStore('chatMessages', {
              keyPath: ['exportId', 'id'],
            })
            chatMsgStore.createIndex('by-export', 'exportId')
          }
        }
      },
    })
  }
  return dbPromise
}

// Backup operations
export async function saveBackup(backup: Backup): Promise<void> {
  const db = await getDB()
  await db.put('backups', backup)
}

export async function getBackup(id: string): Promise<Backup | undefined> {
  const db = await getDB()
  return db.get('backups', id)
}

export async function getAllBackups(): Promise<Backup[]> {
  const db = await getDB()
  return db.getAll('backups')
}

export async function deleteBackup(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['backups', 'messages', 'media'], 'readwrite')

  // Delete backup
  await tx.objectStore('backups').delete(id)

  // Delete associated messages
  const messageIndex = tx.objectStore('messages').index('by-backup')
  let messageCursor = await messageIndex.openCursor(id)
  while (messageCursor) {
    await messageCursor.delete()
    messageCursor = await messageCursor.continue()
  }

  // Delete associated media
  const mediaIndex = tx.objectStore('media').index('by-backup')
  let mediaCursor = await mediaIndex.openCursor(id)
  while (mediaCursor) {
    await mediaCursor.delete()
    mediaCursor = await mediaCursor.continue()
  }

  await tx.done
}

// Message operations
export async function saveMessage(backupId: string, message: DeletedMessage): Promise<void> {
  const db = await getDB()
  // Strip runtime-only `_rawMessage` before persisting (non-serializable GramJS object).
  const sanitized = stripRawMessage(message)
  await db.put('messages', { ...sanitized, backupId })
}

export async function saveMessages(backupId: string, messages: DeletedMessage[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readwrite')
  const store = tx.objectStore('messages')

  for (const message of messages) {
    // Strip runtime-only `_rawMessage` before persisting.
    const sanitized = stripRawMessage(message)
    await store.put({ ...sanitized, backupId })
  }

  await tx.done
}

export async function getMessagesByBackup(backupId: string): Promise<DeletedMessage[]> {
  const db = await getDB()
  const messages = await db.getAllFromIndex('messages', 'by-backup', backupId)
  return messages.map(({ backupId: _, ...msg }) => msg as DeletedMessage)
}

// Media operations
export async function saveMedia(
  backupId: string,
  messageId: number,
  blob: Blob,
  filename: string,
  mimeType: string
): Promise<void> {
  const db = await getDB()
  await db.put('media', { backupId, messageId, blob, filename, mimeType })
}

export async function getMedia(backupId: string, messageId: number): Promise<Blob | undefined> {
  const db = await getDB()
  const media = await db.get('media', [backupId, messageId])
  return media?.blob
}

export async function getMediaByBackup(backupId: string): Promise<Map<number, Blob>> {
  const db = await getDB()
  const mediaItems = await db.getAllFromIndex('media', 'by-backup', backupId)
  const map = new Map<number, Blob>()
  for (const item of mediaItems) {
    map.set(item.messageId, item.blob)
  }
  return map
}

// Utility functions
export async function calculateBackupSize(backupId: string): Promise<number> {
  const db = await getDB()
  let totalSize = 0

  // Count media blobs
  const mediaItems = await db.getAllFromIndex('media', 'by-backup', backupId)
  for (const item of mediaItems) {
    totalSize += item.blob.size
  }

  // Rough estimate for messages (JSON size). Use BigInt-safe stringify
  // because messages may contain bigint chatId/senderId fields.
  const messages = await db.getAllFromIndex('messages', 'by-backup', backupId)
  totalSize += safeJsonStringify(messages).length

  return totalSize
}

export async function countMediaTypes(
  _backupId: string,
  messages: DeletedMessage[]
): Promise<MediaTypeStats> {
  const stats: MediaTypeStats = {
    photos: 0,
    videos: 0,
    documents: 0,
    stickers: 0,
    voiceMessages: 0,
    videoNotes: 0,
    audio: 0,
    gifs: 0,
  }

  for (const msg of messages) {
    switch (msg.mediaType) {
      case 'photo':
        stats.photos++
        break
      case 'video':
        stats.videos++
        break
      case 'document':
        stats.documents++
        break
      case 'sticker':
        stats.stickers++
        break
      case 'voice':
        stats.voiceMessages++
        break
      case 'videoNote':
        stats.videoNotes++
        break
      case 'audio':
        stats.audio++
        break
      case 'animation':
        stats.gifs++
        break
    }
  }

  return stats
}

// =============================================================================
// LLM Context Export Operations
// =============================================================================

// Chat Export operations
export async function saveChatExport(chatExport: ChatExport): Promise<void> {
  const db = await getDB()
  await db.put('chatExports', chatExport)
}

export async function getChatExport(id: string): Promise<ChatExport | undefined> {
  const db = await getDB()
  return db.get('chatExports', id)
}

export async function getAllChatExports(): Promise<ChatExport[]> {
  const db = await getDB()
  return db.getAll('chatExports')
}

export async function deleteChatExport(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['chatExports', 'chatMessages'], 'readwrite')

  // Delete export metadata
  await tx.objectStore('chatExports').delete(id)

  // Delete associated messages
  const messageIndex = tx.objectStore('chatMessages').index('by-export')
  let cursor = await messageIndex.openCursor(id)
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }

  await tx.done
}

// Chat Message operations (for LLM export)
export async function saveChatMessage(exportId: string, message: ChatMessage): Promise<void> {
  const db = await getDB()
  await db.put('chatMessages', { ...message, exportId })
}

export async function saveChatMessages(exportId: string, messages: ChatMessage[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('chatMessages', 'readwrite')
  const store = tx.objectStore('chatMessages')

  for (const message of messages) {
    await store.put({ ...message, exportId })
  }

  await tx.done
}

export async function getChatMessagesByExport(exportId: string): Promise<ChatMessage[]> {
  const db = await getDB()
  const messages = await db.getAllFromIndex('chatMessages', 'by-export', exportId)
  return messages.map(({ exportId: _, ...msg }) => msg as ChatMessage)
}

export async function getChatExportSize(exportId: string): Promise<number> {
  const db = await getDB()

  // Estimate size based on message JSON
  const messages = await db.getAllFromIndex('chatMessages', 'by-export', exportId)
  return safeJsonStringify(messages).length
}
