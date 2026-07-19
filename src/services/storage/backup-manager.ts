/**
 * Backup management service
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  Backup,
  BackupWithMessages,
  CommitOptions,
  DeletedMessage,
  ExportConfig,
  SavedAccount,
} from '@/types'
import { safeJsonStringify, stripRawMessage } from '@/utils/message-serialization'
import { zipGenerator } from '../export/zip-generator'
import * as db from './indexed-db'
import {
  archiveOwnership,
  canAccessContent,
  canManageRecord,
  claimOwnership,
  isLegacyClaimable,
  isOwnedByAccount,
  isVisibleToAccount,
  type NormalizedOwnership,
  normalizeOwnership,
  ownershipForAccount,
  recoverOwnership,
  recoveryChannelForAccount,
  toStoredOwnership,
} from './record-ownership'

/** Overlay a normalized ownership onto a backup, setting every ownership field deterministically. */
function applyOwnership(backup: Backup, ownership: NormalizedOwnership): Backup {
  return {
    ...backup,
    ...toStoredOwnership(ownership),
    ownerAccountId: ownership.ownerAccountId,
    ownerAccountPhone: ownership.ownerAccountPhone,
    ownerPrincipal: ownership.ownerPrincipal,
    archivedAt: ownership.archivedAt,
    archivedReason: ownership.archivedReason,
    quarantineReason: ownership.quarantineReason,
  }
}

function normalizeBackup(backup: Backup): Backup {
  return applyOwnership(backup, normalizeOwnership(backup))
}

function sortBackupsByCreatedAt(backups: Backup[]): Backup[] {
  return backups.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
}

function sortArchivedBackups(backups: Backup[]): Backup[] {
  return backups.sort((left, right) => {
    const leftDate = left.archivedAt ?? left.createdAt
    const rightDate = right.archivedAt ?? right.createdAt
    return rightDate.getTime() - leftDate.getTime()
  })
}

class BackupManager {
  async listBackups(): Promise<Backup[]> {
    const backups = await db.getAllBackups()
    return sortBackupsByCreatedAt(backups.map(normalizeBackup))
  }

  async listBackupsForAccount(account: SavedAccount | null): Promise<Backup[]> {
    if (!account || account.type !== 'user') {
      return []
    }

    await this.recoverArchivedBackupsForAccount(account)

    const backups = await this.listBackups()
    return backups.filter((backup) => isVisibleToAccount(backup, account))
  }

  async listArchivedBackups(): Promise<Backup[]> {
    const backups = await this.listBackups()
    return sortArchivedBackups(
      backups.filter((backup) => normalizeOwnership(backup).lifecycle === 'archived'),
    )
  }

  /**
   * Read a backup and its content. `accessor` is the account context requesting the read; content is
   * returned only when that account owns the record (or it is an unclaimed legacy record). Archived,
   * quarantined, and other-owner records return null so an unrelated active account can never read
   * another principal's content (ARCHITECTURE.md §6 & §7).
   */
  async getBackup(id: string, accessor: SavedAccount | null): Promise<BackupWithMessages | null> {
    const backup = await db.getBackup(id)
    if (!backup) return null

    if (!canAccessContent(backup, accessor)) {
      return null
    }

    const messages = await db.getMessagesByBackup(id)
    const mediaBlobs = await db.getMediaByBackup(id)

    return {
      ...normalizeBackup(backup),
      messages,
      mediaBlobs,
    }
  }

  async createBackup(
    config: ExportConfig,
    messages: DeletedMessage[],
    mediaBlobs: Map<number, Blob>,
    ownerAccount?: SavedAccount | null,
    options?: CommitOptions,
  ): Promise<Backup> {
    return this.createBackupWithOwnership(
      config,
      messages,
      mediaBlobs,
      ownershipForAccount(ownerAccount),
      options,
    )
  }

  private async createBackupWithOwnership(
    config: ExportConfig,
    messages: DeletedMessage[],
    mediaBlobs: Map<number, Blob>,
    ownership: NormalizedOwnership,
    options?: CommitOptions,
  ): Promise<Backup> {
    const id = uuidv4()

    // Calculate media stats
    const mediaTypes = await db.countMediaTypes(id, messages)
    const mediaEntries = Array.from(mediaBlobs.entries()).map(([messageId, blob]) => {
      const message = messages.find((item) => item.id === messageId)

      return {
        messageId,
        blob,
        filename: message?.mediaFilename || `media_${messageId}`,
        mimeType: blob.type,
      }
    })
    const storageSize =
      mediaEntries.reduce((total, entry) => total + entry.blob.size, 0) +
      safeJsonStringify(messages.map((message) => stripRawMessage(message))).length

    const backup: Backup = applyOwnership(
      {
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
      },
      ownership,
    )

    // Final fence immediately before the write: if the owning account was removed while the export
    // ran, this throws and no orphaned owned record is persisted (ARCHITECTURE.md §3, criterion 4).
    options?.ensureCommittable?.()
    await db.saveBackupBundle(backup, messages, mediaEntries)

    return normalizeBackup(backup)
  }

  /**
   * Delete a backup. `accessor` is the account context requesting the deletion; the owner may delete
   * their own records and orphaned records (archived/quarantined/legacy) are manageable
   * account-independently (`accessor` null), but an active record owned by a different principal is
   * protected (ARCHITECTURE.md §6 & §7).
   */
  async deleteBackup(id: string, accessor: SavedAccount | null): Promise<void> {
    const backup = await db.getBackup(id)
    if (!backup) {
      return
    }

    if (!canManageRecord(backup, accessor)) {
      throw new Error('Not authorized to delete this backup')
    }

    await db.deleteBackup(id)
  }

  async claimLegacyBackup(id: string, account: SavedAccount): Promise<Backup> {
    if (account.type !== 'user') {
      throw new Error('Only user accounts can claim backups')
    }

    const storedBackup = await db.getBackup(id)
    if (!storedBackup) {
      throw new Error('Backup not found')
    }

    if (!isLegacyClaimable(storedBackup)) {
      throw new Error('Only legacy backups can be claimed')
    }

    const claimedBackup = applyOwnership(
      normalizeBackup(storedBackup),
      claimOwnership(normalizeOwnership(storedBackup), account),
    )

    await db.saveBackup(claimedBackup)

    return normalizeBackup(claimedBackup)
  }

  /** Records whose owner metadata is missing or inconsistent; surfaced for explicit repair. */
  async listQuarantinedBackups(): Promise<Backup[]> {
    const backups = await this.listBackups()
    return backups.filter((backup) => normalizeOwnership(backup).health === 'quarantined')
  }

  /**
   * Explicit repair: bind a quarantined or legacy record to `account`. This is a deliberate user
   * action for ambiguous records — it never runs automatically.
   */
  async reconcileBackup(id: string, account: SavedAccount): Promise<Backup> {
    if (account.type !== 'user') {
      throw new Error('Only user accounts can reconcile backups')
    }

    const storedBackup = await db.getBackup(id)
    if (!storedBackup) {
      throw new Error('Backup not found')
    }

    const ownership = normalizeOwnership(storedBackup)
    if (ownership.health !== 'quarantined' && ownership.verification !== 'legacy') {
      throw new Error('Only quarantined or legacy backups can be reconciled')
    }

    const reconciled = applyOwnership(
      normalizeBackup(storedBackup),
      claimOwnership(ownership, account),
    )
    await db.saveBackup(reconciled)

    return normalizeBackup(reconciled)
  }

  async getBackupStorageSize(id: string): Promise<number> {
    return db.calculateBackupSize(id)
  }

  async exportBackupToZip(id: string, accessor: SavedAccount | null): Promise<void> {
    const backup = await this.getBackup(id, accessor)
    if (!backup) {
      throw new Error('Backup not found')
    }

    await zipGenerator.generateAndDownload(backup)
  }

  async mergeBackups(ids: string[], accessor: SavedAccount | null): Promise<Backup> {
    if (ids.length < 2) {
      throw new Error('Need at least 2 backups to merge')
    }

    // Load all backups
    const backups: BackupWithMessages[] = []
    let chatId: bigint | null = null

    for (const id of ids) {
      // getBackup enforces per-owner content access, so a set spanning owners cannot be merged: a
      // record the accessor does not own resolves to null and is rejected here (ARCHITECTURE.md §6,
      // "reject mixed-owner merges").
      const backup = await this.getBackup(id, accessor)
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

    // Preserve the source ownership (principal + axes) rather than downgrading to legacy.
    const mergedBackup = await this.createBackupWithOwnership(
      {
        chatId: chatId!,
        chatTitle: backups[0]?.chatTitle ?? 'Merged Backup',
        exportMode: 'all',
        storageStrategy: 'indexeddb',
      },
      messages,
      mediaMap,
      backups[0] ? normalizeOwnership(backups[0]) : ownershipForAccount(null),
    )

    // Delete original backups
    for (const id of ids) {
      await this.deleteBackup(id, accessor)
    }

    return mergedBackup
  }

  async getBackupsByChat(chatId: bigint): Promise<Backup[]> {
    const allBackups = await this.listBackups()
    return allBackups.filter((b) => b.chatId === chatId)
  }

  async archiveBackupsForRemovedAccount(account: SavedAccount): Promise<number> {
    if (account.type !== 'user') {
      return 0
    }

    const backups = await this.listBackups()
    const ownedBackups = backups.filter((backup) => isOwnedByAccount(backup, account))

    await Promise.all(
      ownedBackups.map((backup) =>
        db.saveBackup(applyOwnership(backup, archiveOwnership(normalizeOwnership(backup)))),
      ),
    )

    return ownedBackups.length
  }

  async recoverArchivedBackupsForAccount(account: SavedAccount): Promise<number> {
    if (account.type !== 'user') {
      return 0
    }

    const backups = await this.listBackups()
    const recoverable = backups
      .map((backup) => ({ backup, channel: recoveryChannelForAccount(backup, account) }))
      .filter((entry) => entry.channel !== null)

    await Promise.all(
      recoverable.map(({ backup, channel }) =>
        db.saveBackup(
          applyOwnership(backup, recoverOwnership(normalizeOwnership(backup), account, channel!)),
        ),
      ),
    )

    return recoverable.length
  }
}

// Singleton instance
export const backupManager = new BackupManager()
