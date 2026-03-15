/**
 * Backup management service
 */

import { v4 as uuidv4 } from 'uuid'
import type { Backup, BackupWithMessages, DeletedMessage, ExportConfig } from '@/types'
import { zipGenerator } from '../export/zip-generator'
import * as db from './indexed-db'

class BackupManager {
  async listBackups(): Promise<Backup[]> {
    const backups = await db.getAllBackups()
    // Sort by date, newest first
    return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  async getBackup(id: string): Promise<BackupWithMessages | null> {
    const backup = await db.getBackup(id)
    if (!backup) return null

    const messages = await db.getMessagesByBackup(id)
    const mediaBlobs = await db.getMediaByBackup(id)

    return {
      ...backup,
      messages,
      mediaBlobs,
    }
  }

  async createBackup(
    config: ExportConfig,
    messages: DeletedMessage[],
    mediaBlobs: Map<number, Blob>,
  ): Promise<Backup> {
    const id = uuidv4()

    // Calculate media stats
    const mediaTypes = await db.countMediaTypes(id, messages)

    // Save messages first
    await db.saveMessages(id, messages)

    // Save media blobs
    for (const [messageId, blob] of mediaBlobs) {
      const msg = messages.find((m) => m.id === messageId)
      await db.saveMedia(id, messageId, blob, msg?.mediaFilename || `media_${messageId}`, blob.type)
    }

    // Calculate storage size
    const storageSize = await db.calculateBackupSize(id)

    const backup: Backup = {
      id,
      chatId: config.chatId,
      chatTitle: config.chatTitle,
      chatType: 'channel', // Will be determined from chat info
      createdAt: new Date(),
      messageCount: messages.length,
      mediaCount: mediaBlobs.size,
      storageSize,
      hasMedia: mediaBlobs.size > 0,
      mediaTypes,
      exportMode: config.exportMode,
    }

    await db.saveBackup(backup)

    return backup
  }

  async deleteBackup(id: string): Promise<void> {
    await db.deleteBackup(id)
  }

  async getBackupStorageSize(id: string): Promise<number> {
    return db.calculateBackupSize(id)
  }

  async exportBackupToZip(id: string): Promise<void> {
    const backup = await this.getBackup(id)
    if (!backup) {
      throw new Error('Backup not found')
    }

    await zipGenerator.generateAndDownload(backup)
  }

  async mergeBackups(ids: string[]): Promise<Backup> {
    if (ids.length < 2) {
      throw new Error('Need at least 2 backups to merge')
    }

    // Load all backups
    const backups: BackupWithMessages[] = []
    let chatId: bigint | null = null

    for (const id of ids) {
      const backup = await this.getBackup(id)
      if (!backup) {
        throw new Error(`Backup ${id} not found`)
      }

      // Ensure all backups are from the same chat
      if (chatId === null) {
        chatId = backup.chatId
      } else if (backup.chatId !== chatId) {
        throw new Error('Can only merge backups from the same chat')
      }

      backups.push(backup)
    }

    // Merge messages (deduplicate by message ID)
    const messageMap = new Map<number, DeletedMessage>()
    const mediaMap = new Map<number, Blob>()

    for (const backup of backups) {
      for (const msg of backup.messages) {
        // Keep the most recent version if duplicate
        if (!messageMap.has(msg.id) || msg.date > messageMap.get(msg.id)!.date) {
          messageMap.set(msg.id, msg)
        }
      }

      for (const [msgId, blob] of backup.mediaBlobs) {
        if (!mediaMap.has(msgId)) {
          mediaMap.set(msgId, blob)
        }
      }
    }

    // Create merged backup
    const messages = Array.from(messageMap.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    )

    const mergedBackup = await this.createBackup(
      {
        chatId: chatId!,
        chatTitle: backups[0]?.chatTitle ?? 'Merged Backup',
        exportMode: 'all',
        storageStrategy: 'indexeddb',
      },
      messages,
      mediaMap,
    )

    // Delete original backups
    for (const id of ids) {
      await this.deleteBackup(id)
    }

    return mergedBackup
  }

  async getBackupsByChat(chatId: bigint): Promise<Backup[]> {
    const allBackups = await this.listBackups()
    return allBackups.filter((b) => b.chatId === chatId)
  }
}

// Singleton instance
export const backupManager = new BackupManager()
