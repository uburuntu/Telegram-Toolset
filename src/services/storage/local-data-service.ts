/**
 * Account-independent local-data workspace service.
 *
 * Aggregates the retained, orphaned local records (archived, quarantined, or unclaimed legacy backups
 * and chat exports) that are not tied to a live account, so a user can inspect and clean them up even
 * after removing their last Telegram account. It never exposes record *content* — only metadata and
 * the reason each record is in its current state. Content access still requires ownership via the
 * per-record repository boundaries.
 */
import { chatHistoryService } from '@/services/llm-export/chat-history-service'
import { backupManager } from '@/services/storage/backup-manager'
import type {
  OwnershipVerification,
  RecordHealth,
  RecordLifecycle,
  RecordQuarantineReason,
  StoredRecordArchiveReason,
  StoredRecordOwnership,
} from '@/types'
import * as db from './indexed-db'
import { type NormalizedOwnership, normalizeOwnership } from './record-ownership'

export type LocalDataKind = 'backup' | 'chat-export'

export interface LocalDataRecord {
  id: string
  kind: LocalDataKind
  title: string
  createdAt: Date
  messageCount: number
  sizeBytes: number
  verification: OwnershipVerification
  lifecycle: RecordLifecycle
  health: RecordHealth
  quarantineReason?: RecordQuarantineReason
  archivedReason?: StoredRecordArchiveReason
  ownerPhone?: string
}

export interface LocalDataInventory {
  records: LocalDataRecord[]
  totalSizeBytes: number
}

/**
 * A record belongs in the account-independent workspace when it has no live active owner: archived
 * (owner removed), quarantined (inconsistent metadata), or unclaimed legacy. Active + healthy records
 * are owned by an existing account and are managed from that account's views instead.
 */
function isOrphan(ownership: NormalizedOwnership): boolean {
  return (
    ownership.lifecycle === 'archived' ||
    ownership.health !== 'healthy' ||
    ownership.verification === 'legacy'
  )
}

function toRecord(
  record: StoredRecordOwnership & {
    id: string
    chatTitle: string
    createdAt: Date
    messageCount: number
  },
  kind: LocalDataKind,
  sizeBytes: number,
): LocalDataRecord {
  const ownership = normalizeOwnership(record)
  return {
    id: record.id,
    kind,
    title: record.chatTitle,
    createdAt: record.createdAt,
    messageCount: record.messageCount,
    sizeBytes,
    verification: ownership.verification,
    lifecycle: ownership.lifecycle,
    health: ownership.health,
    quarantineReason: ownership.quarantineReason,
    archivedReason: ownership.archivedReason,
    ownerPhone: ownership.ownerAccountPhone,
  }
}

export async function getLocalDataInventory(): Promise<LocalDataInventory> {
  const [backups, chatExports] = await Promise.all([
    backupManager.listBackups(),
    chatHistoryService.listChatExports(),
  ])

  const records: LocalDataRecord[] = []

  for (const backup of backups) {
    if (isOrphan(normalizeOwnership(backup))) {
      records.push(toRecord(backup, 'backup', backup.storageSize))
    }
  }

  for (const chatExport of chatExports) {
    if (isOrphan(normalizeOwnership(chatExport))) {
      const size = await db.getChatExportSize(chatExport.id)
      records.push(toRecord(chatExport, 'chat-export', size))
    }
  }

  records.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
  const totalSizeBytes = records.reduce((total, record) => total + record.sizeBytes, 0)

  return { records, totalSizeBytes }
}

export interface PurgeSummary {
  backups: number
  chatExports: number
}

/**
 * Delete a single retained record. Routes through the ownership-enforced managers with a null accessor
 * so the same {@link canManageRecord} guard that protects live-account data also gates this path: only
 * orphaned records (archived, quarantined, legacy) can be removed account-independently.
 */
export async function deleteLocalRecord(
  record: Pick<LocalDataRecord, 'id' | 'kind'>,
): Promise<void> {
  if (record.kind === 'backup') {
    await backupManager.deleteBackup(record.id, null)
  } else {
    await chatHistoryService.deleteChatExport(record.id, null)
  }
}

/**
 * Delete every retained (orphaned) record currently listed in the workspace. This is the opt-in bulk
 * purge; its scope is exactly the inventory returned by {@link getLocalDataInventory} — records owned
 * by a live active account are never touched here.
 */
export async function purgeRetainedLocalData(): Promise<PurgeSummary> {
  const { records } = await getLocalDataInventory()
  const summary: PurgeSummary = { backups: 0, chatExports: 0 }

  for (const record of records) {
    await deleteLocalRecord(record)
    if (record.kind === 'backup') {
      summary.backups += 1
    } else {
      summary.chatExports += 1
    }
  }

  return summary
}
