/**
 * IndexedDB operations using idb library
 */

import { openDB, type IDBPDatabase } from 'idb'
import type { Backup, DeletedMessage, MediaTypeStats } from '@/types'
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
}

const DB_NAME = 'telegram-toolset'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<TelegramToolsetDB>> | null = null

async function getDB(): Promise<IDBPDatabase<TelegramToolsetDB>> {
  if (!dbPromise) {
    dbPromise = openDB<TelegramToolsetDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
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
