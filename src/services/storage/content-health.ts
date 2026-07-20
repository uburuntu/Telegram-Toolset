/**
 * Content-health detection for evicted or incomplete local records.
 *
 * Browsers may evict best-effort storage under pressure. When a record's metadata row survives but its
 * message rows are gone, it must be surfaced as recoverable-but-empty rather than presented as an
 * intact backup. These helpers detect that mismatch cheaply (a keyed count, no deserialization) so
 * list views can flag affected records without hiding the rest of the inventory.
 */
import type { Backup, ChatExport } from '@/types'
import { countBackupMessages, countChatExportMessages } from './indexed-db'

type BackupContentRef = Pick<Backup, 'id' | 'messageCount'>
type ChatExportContentRef = Pick<ChatExport, 'id' | 'messageCount'>

/** True when a backup claims content (messageCount > 0) but no message rows remain in storage. */
export async function isBackupContentEvicted(backup: BackupContentRef): Promise<boolean> {
  if (backup.messageCount <= 0) {
    return false
  }
  return (await countBackupMessages(backup.id)) === 0
}

/** True when a chat export claims content (messageCount > 0) but no message rows remain in storage. */
export async function isChatExportContentEvicted(
  chatExport: ChatExportContentRef,
): Promise<boolean> {
  if (chatExport.messageCount <= 0) {
    return false
  }
  return (await countChatExportMessages(chatExport.id)) === 0
}

/**
 * Return the ids of backups whose content was evicted. A per-record probe failure is treated as
 * healthy so a transient read error never hides an otherwise-listable backup.
 */
export async function listEvictedBackupIds(backups: BackupContentRef[]): Promise<Set<string>> {
  const evicted = new Set<string>()
  await Promise.all(
    backups.map(async (backup) => {
      try {
        if (await isBackupContentEvicted(backup)) {
          evicted.add(backup.id)
        }
      } catch (error) {
        console.error(`Failed to probe content health for backup ${backup.id}:`, error)
      }
    }),
  )
  return evicted
}

/**
 * Return the ids of chat exports whose content was evicted. A per-record probe failure is treated as
 * healthy so a transient read error never hides an otherwise-listable export.
 */
export async function listEvictedChatExportIds(
  chatExports: ChatExportContentRef[],
): Promise<Set<string>> {
  const evicted = new Set<string>()
  await Promise.all(
    chatExports.map(async (chatExport) => {
      try {
        if (await isChatExportContentEvicted(chatExport)) {
          evicted.add(chatExport.id)
        }
      } catch (error) {
        console.error(`Failed to probe content health for chat export ${chatExport.id}:`, error)
      }
    }),
  )
  return evicted
}
