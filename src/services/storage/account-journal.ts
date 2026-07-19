/**
 * Write-ahead journal for account mutations that span localStorage metadata and the IndexedDB secret
 * vault (ARCHITECTURE.md §6). A single account add/update/remove cannot be one atomic transaction
 * because the two stores are independent, so a process death between the IndexedDB write and the
 * localStorage write can leave the durable stores inconsistent (a "ghost" account whose secret is
 * gone, or an orphaned secret with no metadata).
 *
 * The protocol is: `begin` a journal entry describing the intended post-success state, perform the
 * two-store mutation, then `complete` (clear) the entry. A dangling entry at startup means a crash
 * happened mid-mutation; {@link readPendingAccountJournal} surfaces it so the accounts store can
 * reconcile the two stores back into agreement.
 *
 * Environments without IndexedDB (rare: private-mode denial, SSR, ancient browsers) degrade to a
 * no-op: the mutation still runs, only crash-recovery journaling is skipped.
 */

import type { AccountJournalRecord } from './indexed-db'
import {
  deleteAccountJournalRecord,
  getAllAccountJournalRecords,
  putAccountJournalRecord,
} from './indexed-db'

export type AccountJournalOp = AccountJournalRecord['op']

export interface AccountJournalEntryInput {
  op: AccountJournalOp
  accountId: string
  /**
   * Snapshot of the localStorage metadata the mutation intends to establish on success. Used by
   * reconciliation as the source of the affected account's metadata entry when rolling forward.
   */
  metadata: AccountJournalRecord['metadata']
}

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

/**
 * Write-ahead a pending mutation before it touches either store. Keyed by account id so at most one
 * pending op exists per account and a retry overwrites its own dangling entry. Returns the journal
 * id to pass to {@link completeAccountJournal}, or `null` when journaling is unavailable — callers
 * treat `null` as "not journaled" and still proceed with the mutation.
 */
export async function beginAccountJournal(entry: AccountJournalEntryInput): Promise<string | null> {
  if (!isIndexedDbAvailable()) {
    return null
  }

  const record: AccountJournalRecord = {
    id: entry.accountId,
    op: entry.op,
    accountId: entry.accountId,
    metadata: entry.metadata,
    createdAt: Date.now(),
  }

  try {
    await putAccountJournalRecord(record)
    return record.id
  } catch (error) {
    // A failed journal write must not fail the mutation itself; we simply lose crash recovery for
    // this one operation, which is strictly better than blocking the user's action.
    console.error('Failed to write account journal entry:', error)
    return null
  }
}

/**
 * Clear a completed mutation's journal entry. Tolerates a `null` id (journaling was unavailable) and
 * swallows its own errors: a stuck entry is harmless because reconciliation is idempotent.
 */
export async function completeAccountJournal(id: string | null): Promise<void> {
  if (id === null || !isIndexedDbAvailable()) {
    return
  }

  try {
    await deleteAccountJournalRecord(id)
  } catch (error) {
    console.error('Failed to clear account journal entry:', error)
  }
}

/** Read every dangling journal entry (each represents a mutation interrupted before completion). */
export async function readPendingAccountJournal(): Promise<AccountJournalRecord[]> {
  if (!isIndexedDbAvailable()) {
    return []
  }

  try {
    return await getAllAccountJournalRecords()
  } catch (error) {
    console.error('Failed to read pending account journal:', error)
    return []
  }
}
