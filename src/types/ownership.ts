import type { TelegramPrincipal } from './principal'

/**
 * Legacy conflated ownership label. Retained for backward compatibility with records written before
 * the independent-axis model and for rollback safety (older readers still understand it). New code
 * should read/write the three independent axes below and treat this field as a derived mirror.
 */
export type StoredRecordOwnershipState = 'owned' | 'archived' | 'legacy'

export type StoredRecordArchiveReason = 'account_removed'

/**
 * Ownership is modeled on three independent axes so that lifecycle changes,
 * identity verification, and record health cannot be conflated into one overloaded label:
 *
 * - `ownerVerification` — is the owning Telegram identity proven?
 *   - `verified`   → a `TelegramPrincipal` authoritatively owns this record.
 *   - `unverified` → owned by a local account UUID only (pre-principal record; migration bridge).
 *   - `legacy`     → no owner was ever recorded; claimable by any compatible account.
 * - `lifecycle` — is the record currently active or archived?
 * - `recordHealth` — is the record self-consistent, or quarantined pending manual repair?
 */
export type OwnershipVerification = 'verified' | 'unverified' | 'legacy'

export type RecordLifecycle = 'active' | 'archived'

export type RecordHealth = 'healthy' | 'quarantined'

export type RecordQuarantineReason = 'owner_metadata_missing' | 'invalid_ownership_state'

export interface StoredRecordOwnership {
  /** Installation-scoped local account UUID. A record key, never proof of Telegram identity. */
  ownerAccountId?: string
  /** Display and recovery *hint* only. Never an ownership authority. */
  ownerAccountPhone?: string
  /** Durable ownership authority derived from Telegram's immutable user ID. */
  ownerPrincipal?: TelegramPrincipal

  /** Derived legacy mirror; kept in sync for old readers and rollback. */
  ownershipState?: StoredRecordOwnershipState

  /** Independent axes (authoritative going forward). */
  ownerVerification?: OwnershipVerification
  lifecycle?: RecordLifecycle
  recordHealth?: RecordHealth
  quarantineReason?: RecordQuarantineReason

  archivedAt?: Date
  archivedReason?: StoredRecordArchiveReason
}
