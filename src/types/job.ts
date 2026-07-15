/**
 * Account-affine job runtime types (ARCHITECTURE.md §3).
 *
 * A job is a request-scoped unit of long-running work (export, resend, scheduled scan/delete,
 * chat-history export, archive build). Its {@link JobContext} is captured at creation and is
 * immutable: ownership and the session generation are never re-read from global state at
 * completion. Callbacks and persistence commits must verify the context before mutating UI or
 * writing owned data.
 */
import type { TelegramPrincipal } from './principal'

export type JobKind =
  | 'export'
  | 'resend'
  | 'scheduled-scan'
  | 'scheduled-delete'
  | 'chat-history'
  | 'archive'

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

/**
 * Threaded into a persistence commit boundary so the storage layer can enforce the account-epoch
 * fence without depending on any store. `ensureCommittable` runs synchronously immediately before
 * the durable write and must throw (an AbortError) when the owning account has been removed since
 * the job started, so the write is skipped rather than orphaning an owned record (§3, criterion 4).
 */
export interface CommitOptions {
  ensureCommittable?: () => void
}

/**
 * Immutable execution context stamped onto a job at creation. `peer` intentionally arrives with the
 * canonical `PeerRef` in Stage D (§4); until then multi-peer jobs carry their own peer identifiers.
 */
export interface JobContext {
  operationId: string
  accountId: string
  principal: TelegramPrincipal
  /** Session coordinator generation captured at job creation. */
  sessionGeneration: number
  /** Account epoch captured at job creation; a later removal advances it and fences stale commits. */
  accountEpoch: number
  signal: AbortSignal
}

export interface JobProgress {
  current: number
  total: number
  label?: string
}

/**
 * Serializable record surfaced by the shell job registry. It deliberately excludes the
 * `AbortController`/`AbortSignal` (those stay with the job owner) so the registry stays a pure,
 * observable projection of job state.
 */
export interface JobRecord {
  operationId: string
  kind: JobKind
  title: string
  accountId: string
  principal: TelegramPrincipal
  sessionGeneration: number
  accountEpoch: number
  status: JobStatus
  progress?: JobProgress
  error?: string
  createdAt: Date
  updatedAt: Date
}

/**
 * Delivery classification for mutations whose server acceptance cannot be confirmed. `abandoned`
 * marks a job fenced after a bounded cancellation deadline; `delivery_uncertain` marks an ambiguous
 * send that must be reconciled explicitly rather than blindly retried (see §3 and §5).
 */
export type DeliveryOutcome =
  | 'delivered'
  | 'failed'
  | 'skipped'
  | 'delivery_uncertain'
  | 'abandoned'

/** Result of acting on a single peer within a destructive multi-peer job. */
export interface PeerOutcome {
  /** Stable identifier for the peer (raw id / chat id as a string until PeerRef lands in Stage D). */
  peerId: string
  status: DeliveryOutcome
  /** How many items were confirmed for this peer (e.g. messages deleted). */
  affected?: number
  error?: string
}

/**
 * Aggregate result for a destructive multi-peer job. Confirmed per-peer successes are preserved even
 * when a later peer fails, so partial success can be reported accurately (§3 exit criterion 6).
 */
export interface MultiPeerResult {
  outcomes: PeerOutcome[]
}

export function summarizeMultiPeerResult(result: MultiPeerResult): {
  total: number
  succeeded: number
  failed: number
  skipped: number
  uncertain: number
  affected: number
} {
  let succeeded = 0
  let failed = 0
  let skipped = 0
  let uncertain = 0
  let affected = 0

  for (const outcome of result.outcomes) {
    affected += outcome.affected ?? 0
    switch (outcome.status) {
      case 'delivered':
        succeeded += 1
        break
      case 'failed':
        failed += 1
        break
      case 'skipped':
        skipped += 1
        break
      case 'delivery_uncertain':
      case 'abandoned':
        uncertain += 1
        break
    }
  }

  return {
    total: result.outcomes.length,
    succeeded,
    failed,
    skipped,
    uncertain,
    affected,
  }
}
