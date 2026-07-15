/**
 * Pure ownership-axis engine shared by the backup and LLM-export stores.
 *
 * It maps the legacy conflated `ownershipState` and the new independent axes
 * (verification / lifecycle / health) onto one canonical `NormalizedOwnership`, validates the
 * combination fail-closed (invalid state -> quarantined, never silently "owned"), and derives
 * visibility and recovery eligibility. Ownership authority is the `TelegramPrincipal`; the local
 * account UUID is only a migration bridge for pre-principal records and the phone number is never
 * an authority. See ARCHITECTURE.md §1.
 */
import type {
  OwnershipVerification,
  RecordHealth,
  RecordLifecycle,
  RecordQuarantineReason,
  SavedAccount,
  StoredRecordArchiveReason,
  StoredRecordOwnership,
  StoredRecordOwnershipState,
  TelegramPrincipal,
} from '@/types'
import { principalsMatch } from '@/utils/principal'

export interface NormalizedOwnership {
  ownerAccountId?: string
  ownerAccountPhone?: string
  ownerPrincipal?: TelegramPrincipal
  verification: OwnershipVerification
  lifecycle: RecordLifecycle
  health: RecordHealth
  quarantineReason?: RecordQuarantineReason
  archivedAt?: Date
  archivedReason?: StoredRecordArchiveReason
}

export type RecoveryChannel = 'principal' | 'phone-bridge'

function coerceDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined
  }
  return value instanceof Date ? value : new Date(value)
}

/** Derive the three axes for a record that predates the explicit-axis model. */
function deriveAxesFromLegacy(record: StoredRecordOwnership): {
  verification: OwnershipVerification
  lifecycle: RecordLifecycle
} {
  const hasPrincipal = Boolean(record.ownerPrincipal)
  const hasLocalOwner = Boolean(record.ownerAccountId)

  switch (record.ownershipState) {
    case 'legacy':
      return { verification: 'legacy', lifecycle: 'active' }
    case 'archived':
      return {
        verification: hasPrincipal ? 'verified' : hasLocalOwner ? 'unverified' : 'legacy',
        lifecycle: 'archived',
      }
    case 'owned':
      return { verification: hasPrincipal ? 'verified' : 'unverified', lifecycle: 'active' }
    default:
      // No legacy label: infer from whatever owner signal exists.
      if (hasPrincipal) {
        return { verification: 'verified', lifecycle: 'active' }
      }
      if (hasLocalOwner) {
        return { verification: 'unverified', lifecycle: 'active' }
      }
      return { verification: 'legacy', lifecycle: 'active' }
  }
}

/**
 * Validate the ownership combination. Returns a quarantine reason when the record is internally
 * inconsistent so callers can fail closed instead of exposing content under a false owner.
 */
function ownershipQuarantineReason(
  verification: OwnershipVerification,
  ownerPrincipal: TelegramPrincipal | undefined,
  ownerAccountId: string | undefined,
): RecordQuarantineReason | undefined {
  // A principal is proof of verified identity. Any non-verified record that still carries one is
  // internally inconsistent (e.g. legacy+principal would be claimable by anyone, unverified+principal
  // would be neither owned nor claimable). Fail closed instead of exposing it under a false owner.
  if (verification !== 'verified' && ownerPrincipal) {
    return 'invalid_ownership_state'
  }
  if (verification === 'verified' && !ownerPrincipal) {
    return 'owner_metadata_missing'
  }
  if (verification === 'unverified' && !ownerAccountId) {
    return 'owner_metadata_missing'
  }
  return undefined
}

export function normalizeOwnership(record: StoredRecordOwnership): NormalizedOwnership {
  const explicitVerification = record.ownerVerification
  const explicitLifecycle = record.lifecycle
  const derived = deriveAxesFromLegacy(record)

  const verification = explicitVerification ?? derived.verification
  const lifecycle = explicitLifecycle ?? derived.lifecycle

  const quarantineReason =
    record.recordHealth === 'quarantined'
      ? (record.quarantineReason ?? 'invalid_ownership_state')
      : ownershipQuarantineReason(verification, record.ownerPrincipal, record.ownerAccountId)

  return {
    ownerAccountId: record.ownerAccountId,
    ownerAccountPhone: record.ownerAccountPhone,
    ownerPrincipal: record.ownerPrincipal,
    verification,
    lifecycle,
    health: quarantineReason ? 'quarantined' : 'healthy',
    quarantineReason,
    archivedAt: coerceDate(record.archivedAt),
    archivedReason: record.archivedReason,
  }
}

/** Legacy mirror kept in sync so older readers and rollbacks still behave sanely. */
export function deriveLegacyOwnershipState(
  ownership: NormalizedOwnership,
): StoredRecordOwnershipState {
  if (ownership.lifecycle === 'archived') {
    return 'archived'
  }
  if (ownership.verification === 'legacy') {
    return 'legacy'
  }
  return 'owned'
}

/** Serialize normalized ownership back onto the persisted fields (axes + legacy mirror). */
export function toStoredOwnership(ownership: NormalizedOwnership): StoredRecordOwnership {
  const stored: StoredRecordOwnership = {
    ownerVerification: ownership.verification,
    lifecycle: ownership.lifecycle,
    recordHealth: ownership.health,
    ownershipState: deriveLegacyOwnershipState(ownership),
  }

  if (ownership.ownerAccountId !== undefined) stored.ownerAccountId = ownership.ownerAccountId
  if (ownership.ownerAccountPhone !== undefined)
    stored.ownerAccountPhone = ownership.ownerAccountPhone
  if (ownership.ownerPrincipal !== undefined) stored.ownerPrincipal = ownership.ownerPrincipal
  if (ownership.quarantineReason !== undefined) stored.quarantineReason = ownership.quarantineReason
  if (ownership.archivedAt !== undefined) stored.archivedAt = ownership.archivedAt
  if (ownership.archivedReason !== undefined) stored.archivedReason = ownership.archivedReason

  return stored
}

/** Ownership for an unclaimed (legacy) record with no recorded owner. */
export function legacyOwnership(): NormalizedOwnership {
  return { verification: 'legacy', lifecycle: 'active', health: 'healthy' }
}

/** Ownership for a freshly created record owned by `account`. */
export function createOwnedOwnership(account: SavedAccount): NormalizedOwnership {
  const principal = account.principal
  return {
    ownerAccountId: account.id,
    ownerAccountPhone: account.phone,
    ownerPrincipal: principal,
    verification: principal ? 'verified' : 'unverified',
    lifecycle: 'active',
    health: 'healthy',
  }
}

/** Ownership for a new record: owned by `account`, or legacy when there is no owner. */
export function ownershipForAccount(account: SavedAccount | null | undefined): NormalizedOwnership {
  return account ? createOwnedOwnership(account) : legacyOwnership()
}

export function archiveOwnership(
  ownership: NormalizedOwnership,
  reason: StoredRecordArchiveReason = 'account_removed',
): NormalizedOwnership {
  // Legal transition is active -> archived only. Re-archiving is a no-op so an illegal repeat
  // cannot reset the original archive metadata.
  if (ownership.lifecycle === 'archived') {
    return ownership
  }

  return {
    ...ownership,
    lifecycle: 'archived',
    archivedAt: new Date(),
    archivedReason: reason,
  }
}

function isActiveAndHealthy(ownership: NormalizedOwnership): boolean {
  return ownership.lifecycle === 'active' && ownership.health === 'healthy'
}

/** True when `account` authoritatively (or via the unverified local bridge) owns the record. */
export function isOwnedByAccount(record: StoredRecordOwnership, account: SavedAccount): boolean {
  const ownership = normalizeOwnership(record)
  if (!isActiveAndHealthy(ownership)) {
    return false
  }

  if (ownership.verification === 'verified') {
    return principalsMatch(ownership.ownerPrincipal, account.principal)
  }

  if (ownership.verification === 'unverified') {
    // Migration bridge: pre-principal records are bound to the local account UUID only.
    return ownership.ownerAccountId !== undefined && ownership.ownerAccountId === account.id
  }

  return false
}

/** Legacy records have no recorded owner and can be claimed by any compatible account. */
export function isLegacyClaimable(record: StoredRecordOwnership): boolean {
  const ownership = normalizeOwnership(record)
  return ownership.verification === 'legacy' && isActiveAndHealthy(ownership)
}

/** Records shown in an account's list: owned by it, or unclaimed legacy records. */
export function isVisibleToAccount(record: StoredRecordOwnership, account: SavedAccount): boolean {
  return isOwnedByAccount(record, account) || isLegacyClaimable(record)
}

/**
 * Whether an archived record can be recovered for `account`, and through which channel. Principal
 * match is authoritative; the phone bridge only applies to pre-principal archives so migrating
 * users are never stranded, and it never upgrades verification.
 */
export function recoveryChannelForAccount(
  record: StoredRecordOwnership,
  account: SavedAccount,
): RecoveryChannel | null {
  const ownership = normalizeOwnership(record)
  if (ownership.lifecycle !== 'archived' || ownership.health !== 'healthy') {
    return null
  }

  if (ownership.ownerPrincipal && principalsMatch(ownership.ownerPrincipal, account.principal)) {
    return 'principal'
  }

  if (
    !ownership.ownerPrincipal &&
    ownership.ownerAccountPhone &&
    account.phone &&
    ownership.ownerAccountPhone === account.phone
  ) {
    return 'phone-bridge'
  }

  return null
}

export function recoverOwnership(
  ownership: NormalizedOwnership,
  account: SavedAccount,
  channel: RecoveryChannel,
): NormalizedOwnership {
  const recovered: NormalizedOwnership = {
    ...ownership,
    ownerAccountId: account.id,
    ownerAccountPhone: account.phone ?? ownership.ownerAccountPhone,
    lifecycle: 'active',
    health: 'healthy',
    quarantineReason: undefined,
    archivedAt: undefined,
    archivedReason: undefined,
  }

  if (channel === 'principal' && account.principal) {
    // Principal match is the only channel allowed to (re)affirm verified ownership.
    recovered.ownerPrincipal = account.principal
    recovered.verification = 'verified'
  } else {
    // Phone bridge rebinds the local owner without upgrading verification.
    recovered.verification = ownership.ownerPrincipal ? ownership.verification : 'unverified'
  }

  return recovered
}

/** Explicit user action: bind a legacy or quarantined record to `account`. */
export function claimOwnership(
  ownership: NormalizedOwnership,
  account: SavedAccount,
): NormalizedOwnership {
  return {
    ...ownership,
    ownerAccountId: account.id,
    ownerAccountPhone: account.phone ?? ownership.ownerAccountPhone,
    // The claiming account is the sole authority: never inherit a foreign principal, since a
    // principal-less account keeping one would produce an inconsistent unverified+principal record.
    ownerPrincipal: account.principal,
    verification: account.principal ? 'verified' : 'unverified',
    lifecycle: 'active',
    health: 'healthy',
    quarantineReason: undefined,
    archivedAt: undefined,
    archivedReason: undefined,
  }
}
