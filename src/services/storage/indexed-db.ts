/**
 * IndexedDB operations using idb library
 */

import { type IDBPDatabase, openDB } from 'idb'
import type { Backup, ChatExport, ChatMessage, DeletedMessage, MediaTypeStats } from '@/types'
import { safeJsonStringify, stripRawMessage } from '@/utils/message-serialization'
import { toPlainSnapshot } from '@/utils/reactive-snapshot'

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
  secureVaultKeys: {
    key: string
    value: SecureVaultKeyRecord
  }
  secureVaultSecrets: {
    key: string
    value: SecureVaultSecretRecord
  }
  accountJournal: {
    key: string
    value: AccountJournalRecord
  }
}

const DB_NAME = 'telegram-toolset'
const DB_VERSION = 4

export interface BackupMediaEntry {
  messageId: number
  blob: Blob
  filename: string
  mimeType: string
}

export interface SecureVaultKeyRecord {
  id: string
  key: CryptoKey
}

export interface SecureVaultSecretRecord {
  id: string
  iv: Uint8Array
  ciphertext: ArrayBuffer
}

/**
 * Write-ahead journal entry for a multi-store account mutation (localStorage metadata + IndexedDB
 * secret). Only non-secret metadata is journaled; the encrypted secret stays in the vault. A dangling
 * entry after a crash is reconciled on startup.
 */
export interface AccountJournalRecord {
  id: string
  op: 'add' | 'update' | 'remove'
  accountId: string
  /** Post-success localStorage metadata to establish on roll-forward (plaintext, already in LS). */
  metadata: {
    accounts: unknown
    activeAccountId: string | null
  }
  createdAt: number
}

let dbPromise: Promise<IDBPDatabase<TelegramToolsetDB>> | null = null

/**
 * Drop the cached connection so the next {@link getDB} reopens a fresh one. Used when the browser
 * terminates the connection, when another tab needs to upgrade the schema, or when an open attempt
 * fails — none of which should leave a permanently poisoned promise.
 */
function resetDbConnection(): void {
  dbPromise = null
}

async function getDB(): Promise<IDBPDatabase<TelegramToolsetDB>> {
  if (!dbPromise) {
    const pending = openDB<TelegramToolsetDB>(DB_NAME, DB_VERSION, {
      blocked(currentVersion, blockedVersion) {
        // Another tab still holds an older connection; the upgrade waits until it closes.
        console.warn(
          `IndexedDB upgrade to v${blockedVersion} is blocked by an open connection at v${currentVersion}. Close other tabs of this app to continue.`,
        )
      },
      blocking(currentVersion, blockedVersion, event) {
        // A newer tab wants to upgrade the schema. Close this connection so it can proceed and drop
        // the cache so our next call reopens against the new version instead of deadlocking.
        console.warn(
          `Closing IndexedDB v${currentVersion} so another tab can upgrade to v${blockedVersion}.`,
        )
        const connection = event.target as { close?: () => void } | null
        connection?.close?.()
        resetDbConnection()
      },
      terminated() {
        // The browser abnormally closed the connection (e.g. storage reclamation). Reopen lazily.
        console.warn('IndexedDB connection was terminated; it will reopen on next use.')
        resetDbConnection()
      },
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

        // Version 3: Encrypted account/session storage
        if (oldVersion < 3) {
          if (!db.objectStoreNames.contains('secureVaultKeys')) {
            db.createObjectStore('secureVaultKeys', { keyPath: 'id' })
          }

          if (!db.objectStoreNames.contains('secureVaultSecrets')) {
            db.createObjectStore('secureVaultSecrets', { keyPath: 'id' })
          }
        }

        // Version 4: Write-ahead journal for cross-store account mutations
        if (oldVersion < 4) {
          if (!db.objectStoreNames.contains('accountJournal')) {
            db.createObjectStore('accountJournal', { keyPath: 'id' })
          }
        }
      },
    })

    // A failed open (blocked forever, quota, private-mode denial) must not poison the cache; drop it
    // so the next call can retry a fresh open.
    pending.catch(() => {
      resetDbConnection()
    })
    dbPromise = pending
  }
  return dbPromise
}

// Write invariant: every value handed to `.put()` passes through `toPlainSnapshot` first. IndexedDB
// stores via structured clone, which WebKit rejects with `DataCloneError` on any Vue reactive
// `Proxy` (records often originate from reactive store/UI state). Snapshotting is a no-op on data
// that is already plain and preserves clone-safe leaves (bigint, Date, Blob, ArrayBuffer, CryptoKey),
// so it is applied uniformly with no exceptions rather than case-by-case.

// Backup operations
export async function saveBackup(backup: Backup): Promise<void> {
  const db = await getDB()
  await db.put('backups', toPlainSnapshot(backup))
}

export async function saveBackupBundle(
  backup: Backup,
  messages: DeletedMessage[],
  mediaEntries: BackupMediaEntry[],
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['backups', 'messages', 'media'], 'readwrite')

  await tx.objectStore('backups').put(toPlainSnapshot(backup))

  const messageStore = tx.objectStore('messages')
  for (const message of messages) {
    const sanitized = stripRawMessage(message)
    await messageStore.put(toPlainSnapshot({ ...sanitized, backupId: backup.id }))
  }

  const mediaStore = tx.objectStore('media')
  for (const mediaEntry of mediaEntries) {
    await mediaStore.put(
      toPlainSnapshot({
        backupId: backup.id,
        messageId: mediaEntry.messageId,
        blob: mediaEntry.blob,
        filename: mediaEntry.filename,
        mimeType: mediaEntry.mimeType,
      }),
    )
  }

  await tx.done
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
  await db.put('messages', toPlainSnapshot({ ...sanitized, backupId }))
}

export async function saveMessages(backupId: string, messages: DeletedMessage[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readwrite')
  const store = tx.objectStore('messages')

  for (const message of messages) {
    // Strip runtime-only `_rawMessage` before persisting.
    const sanitized = stripRawMessage(message)
    await store.put(toPlainSnapshot({ ...sanitized, backupId }))
  }

  await tx.done
}

export async function getMessagesByBackup(backupId: string): Promise<DeletedMessage[]> {
  const db = await getDB()
  const messages = await db.getAllFromIndex('messages', 'by-backup', backupId)
  return messages.map(({ backupId: _, ...msg }) => msg as DeletedMessage)
}

/**
 * Count persisted message rows for a backup without deserializing them. Used to detect content that
 * the browser evicted (metadata row survives, message rows are gone) — see content-health.ts.
 */
export async function countBackupMessages(backupId: string): Promise<number> {
  const db = await getDB()
  return db.countFromIndex('messages', 'by-backup', backupId)
}

// Media operations
export async function saveMedia(
  backupId: string,
  messageId: number,
  blob: Blob,
  filename: string,
  mimeType: string,
): Promise<void> {
  const db = await getDB()
  await db.put('media', toPlainSnapshot({ backupId, messageId, blob, filename, mimeType }))
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
  messages: DeletedMessage[],
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
    polls: 0,
    locations: 0,
    contacts: 0,
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
      case 'poll':
        stats.polls++
        break
      case 'location':
        stats.locations++
        break
      case 'contact':
        stats.contacts++
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
  await db.put('chatExports', toPlainSnapshot(chatExport))
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
  await db.put('chatMessages', toPlainSnapshot({ ...message, exportId }))
}

export async function saveChatMessages(exportId: string, messages: ChatMessage[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('chatMessages', 'readwrite')
  const store = tx.objectStore('chatMessages')

  for (const message of messages) {
    await store.put(toPlainSnapshot({ ...message, exportId }))
  }

  await tx.done
}

export async function saveChatExportBundle(
  chatExport: ChatExport,
  messages: ChatMessage[],
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['chatExports', 'chatMessages'], 'readwrite')

  await tx.objectStore('chatExports').put(toPlainSnapshot(chatExport))

  const store = tx.objectStore('chatMessages')
  for (const message of messages) {
    await store.put(toPlainSnapshot({ ...message, exportId: chatExport.id }))
  }

  await tx.done
}

export async function getChatMessagesByExport(exportId: string): Promise<ChatMessage[]> {
  const db = await getDB()
  const messages = await db.getAllFromIndex('chatMessages', 'by-export', exportId)
  return messages.map(({ exportId: _, ...msg }) => msg as ChatMessage)
}

/**
 * Count persisted message rows for a chat export without deserializing them. Used to detect content
 * the browser evicted (metadata survives, message rows are gone) — see content-health.ts.
 */
export async function countChatExportMessages(exportId: string): Promise<number> {
  const db = await getDB()
  return db.countFromIndex('chatMessages', 'by-export', exportId)
}

export async function getChatExportSize(exportId: string): Promise<number> {
  const db = await getDB()

  // Estimate size based on message JSON
  const messages = await db.getAllFromIndex('chatMessages', 'by-export', exportId)
  return safeJsonStringify(messages).length
}

// =============================================================================
// Secure Vault Operations
// =============================================================================

export async function getSecureVaultKey(id: string): Promise<CryptoKey | undefined> {
  const db = await getDB()
  return (await db.get('secureVaultKeys', id))?.key
}

export async function putSecureVaultKey(id: string, key: CryptoKey): Promise<void> {
  const db = await getDB()
  await db.put('secureVaultKeys', toPlainSnapshot({ id, key }))
}

export async function getSecureVaultSecret(
  id: string,
): Promise<SecureVaultSecretRecord | undefined> {
  const db = await getDB()
  return db.get('secureVaultSecrets', id)
}

export async function putSecureVaultSecret(record: SecureVaultSecretRecord): Promise<void> {
  const db = await getDB()
  await db.put('secureVaultSecrets', toPlainSnapshot(record))
}

export async function deleteSecureVaultSecret(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('secureVaultSecrets', id)
}

export async function countSecureVaultSecrets(): Promise<number> {
  const db = await getDB()
  return db.count('secureVaultSecrets')
}

export async function clearSecureVaultSecrets(): Promise<void> {
  const db = await getDB()
  await db.clear('secureVaultSecrets')
}

// =============================================================================
// Account Journal Operations
// =============================================================================

export async function putAccountJournalRecord(record: AccountJournalRecord): Promise<void> {
  const db = await getDB()
  await db.put('accountJournal', toPlainSnapshot(record))
}

export async function getAllAccountJournalRecords(): Promise<AccountJournalRecord[]> {
  const db = await getDB()
  return db.getAll('accountJournal')
}

export async function deleteAccountJournalRecord(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('accountJournal', id)
}
