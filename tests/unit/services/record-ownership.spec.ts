import { describe, expect, it } from 'vitest'
import {
  archiveOwnership,
  canAccessContent,
  canManageRecord,
  claimOwnership,
  createOwnedOwnership,
  deriveLegacyOwnershipState,
  isLegacyClaimable,
  isOwnedByAccount,
  isVisibleToAccount,
  normalizeOwnership,
  recoverOwnership,
  recoveryChannelForAccount,
  toStoredOwnership,
} from '@/services/storage/record-ownership'
import type { SavedAccount, StoredRecordOwnership, TelegramPrincipal } from '@/types'

function makeAccount(overrides: Partial<SavedAccount> = {}): SavedAccount {
  return {
    id: 'account-1',
    type: 'user',
    label: 'Test',
    phone: '+15550001',
    principal: { kind: 'user', telegramUserId: '100' },
    sessionString: 'session',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

const principal100: TelegramPrincipal = { kind: 'user', telegramUserId: '100' }

describe('normalizeOwnership (legacy derivation)', () => {
  it('maps legacy "owned" records without a principal to unverified/active/healthy', () => {
    const n = normalizeOwnership({ ownershipState: 'owned', ownerAccountId: 'account-1' })
    expect(n).toMatchObject({ verification: 'unverified', lifecycle: 'active', health: 'healthy' })
  })

  it('maps legacy "owned" records with a principal to verified', () => {
    const n = normalizeOwnership({
      ownershipState: 'owned',
      ownerAccountId: 'account-1',
      ownerPrincipal: principal100,
    })
    expect(n.verification).toBe('verified')
  })

  it('maps legacy "archived" records', () => {
    const n = normalizeOwnership({
      ownershipState: 'archived',
      ownerAccountId: 'account-1',
      ownerAccountPhone: '+15550001',
      archivedAt: new Date('2026-02-02T00:00:00.000Z'),
    })
    expect(n).toMatchObject({ verification: 'unverified', lifecycle: 'archived', health: 'healthy' })
    expect(n.archivedAt).toBeInstanceOf(Date)
  })

  it('maps legacy "legacy" records to the legacy verification axis', () => {
    const n = normalizeOwnership({ ownershipState: 'legacy' })
    expect(n).toMatchObject({ verification: 'legacy', lifecycle: 'active', health: 'healthy' })
  })

  it('infers axes when no legacy label is present', () => {
    expect(normalizeOwnership({ ownerPrincipal: principal100 }).verification).toBe('verified')
    expect(normalizeOwnership({ ownerAccountId: 'account-1' }).verification).toBe('unverified')
    expect(normalizeOwnership({}).verification).toBe('legacy')
  })

  it('coerces stored ISO archivedAt strings to Date', () => {
    const n = normalizeOwnership({
      lifecycle: 'archived',
      ownerVerification: 'verified',
      ownerPrincipal: principal100,
      archivedAt: '2026-03-03T00:00:00.000Z' as unknown as Date,
    })
    expect(n.archivedAt).toBeInstanceOf(Date)
  })
})

describe('normalizeOwnership (fail-closed validation)', () => {
  it('quarantines a verified record with no principal', () => {
    const n = normalizeOwnership({ ownerVerification: 'verified' })
    expect(n.health).toBe('quarantined')
    expect(n.quarantineReason).toBe('owner_metadata_missing')
  })

  it('quarantines an unverified record with no owner metadata at all', () => {
    const n = normalizeOwnership({ ownerVerification: 'unverified' })
    expect(n.health).toBe('quarantined')
  })

  it('preserves an explicit quarantine flag', () => {
    const n = normalizeOwnership({
      ownerVerification: 'verified',
      ownerPrincipal: principal100,
      recordHealth: 'quarantined',
      quarantineReason: 'invalid_ownership_state',
    })
    expect(n.health).toBe('quarantined')
    expect(n.quarantineReason).toBe('invalid_ownership_state')
  })

  it('quarantines a legacy record that still carries a principal (fails closed, not claimable)', () => {
    const record: StoredRecordOwnership = { ownershipState: 'legacy', ownerPrincipal: principal100 }
    const n = normalizeOwnership(record)
    expect(n.health).toBe('quarantined')
    expect(n.quarantineReason).toBe('invalid_ownership_state')
    // Must not be claimable by an arbitrary account while inconsistent.
    expect(isLegacyClaimable(record)).toBe(false)
    expect(isVisibleToAccount(record, makeAccount())).toBe(false)
  })

  it('quarantines an unverified record that carries a principal (no invisible orphan)', () => {
    const record: StoredRecordOwnership = {
      ownerVerification: 'unverified',
      ownerPrincipal: principal100,
    }
    const n = normalizeOwnership(record)
    expect(n.health).toBe('quarantined')
    expect(n.quarantineReason).toBe('invalid_ownership_state')
    // It is neither owned nor visible, but it is surfaced via the quarantine list for repair.
    expect(isOwnedByAccount(record, makeAccount())).toBe(false)
    expect(isVisibleToAccount(record, makeAccount())).toBe(false)
  })
})

describe('legacy mirror + serialization', () => {
  it('derives the legacy ownershipState from axes', () => {
    expect(deriveLegacyOwnershipState(normalizeOwnership({ ownershipState: 'owned', ownerAccountId: 'a' }))).toBe('owned')
    expect(deriveLegacyOwnershipState(normalizeOwnership({ ownershipState: 'legacy' }))).toBe('legacy')
    expect(
      deriveLegacyOwnershipState(
        normalizeOwnership({ ownershipState: 'archived', ownerAccountId: 'a' }),
      ),
    ).toBe('archived')
  })

  it('round-trips through toStoredOwnership with a legacy mirror', () => {
    const account = makeAccount()
    const stored = toStoredOwnership(createOwnedOwnership(account))
    expect(stored).toMatchObject({
      ownerAccountId: 'account-1',
      ownerPrincipal: principal100,
      ownerVerification: 'verified',
      lifecycle: 'active',
      recordHealth: 'healthy',
      ownershipState: 'owned',
    })
    // Re-normalizing the serialized form is stable.
    expect(normalizeOwnership(stored).verification).toBe('verified')
  })
})

describe('createOwnedOwnership', () => {
  it('is verified when the account has a principal', () => {
    expect(createOwnedOwnership(makeAccount()).verification).toBe('verified')
  })

  it('is unverified when the account has no principal', () => {
    expect(createOwnedOwnership(makeAccount({ principal: undefined })).verification).toBe('unverified')
  })
})

describe('ownership visibility', () => {
  const verifiedRecord: StoredRecordOwnership = {
    ownerVerification: 'verified',
    lifecycle: 'active',
    ownerPrincipal: principal100,
    ownerAccountId: 'old-uuid',
  }

  it('verified records are owned only by the matching principal', () => {
    expect(isOwnedByAccount(verifiedRecord, makeAccount())).toBe(true)
    expect(
      isOwnedByAccount(verifiedRecord, makeAccount({ principal: { kind: 'user', telegramUserId: '200' } })),
    ).toBe(false)
  })

  it('verified ownership ignores the local account UUID', () => {
    // Different local id, same principal -> still owned (survives re-install/re-login).
    expect(isOwnedByAccount(verifiedRecord, makeAccount({ id: 'brand-new-uuid' }))).toBe(true)
  })

  it('unverified records fall back to the local account UUID bridge', () => {
    const record: StoredRecordOwnership = { ownershipState: 'owned', ownerAccountId: 'account-1' }
    expect(isOwnedByAccount(record, makeAccount({ principal: undefined }))).toBe(true)
    expect(isOwnedByAccount(record, makeAccount({ id: 'other', principal: undefined }))).toBe(false)
  })

  it('legacy records are claimable but not owned', () => {
    const record: StoredRecordOwnership = { ownershipState: 'legacy' }
    expect(isOwnedByAccount(record, makeAccount())).toBe(false)
    expect(isLegacyClaimable(record)).toBe(true)
    expect(isVisibleToAccount(record, makeAccount())).toBe(true)
  })

  it('archived and quarantined records are never owned or visible', () => {
    const archived: StoredRecordOwnership = {
      ownershipState: 'archived',
      ownerPrincipal: principal100,
    }
    expect(isOwnedByAccount(archived, makeAccount())).toBe(false)
    expect(isVisibleToAccount(archived, makeAccount())).toBe(false)

    const quarantined: StoredRecordOwnership = { ownerVerification: 'verified' }
    expect(isVisibleToAccount(quarantined, makeAccount())).toBe(false)
  })
})

describe('recovery eligibility and application', () => {
  it('recovers archived records for the matching principal', () => {
    const record: StoredRecordOwnership = {
      ownershipState: 'archived',
      ownerPrincipal: principal100,
      ownerAccountPhone: '+15550001',
    }
    expect(recoveryChannelForAccount(record, makeAccount())).toBe('principal')

    const recovered = recoverOwnership(normalizeOwnership(record), makeAccount({ id: 'new-uuid' }), 'principal')
    expect(recovered).toMatchObject({ lifecycle: 'active', verification: 'verified', ownerAccountId: 'new-uuid' })
    expect(recovered.archivedAt).toBeUndefined()
  })

  it('does not recover across different principals', () => {
    const record: StoredRecordOwnership = {
      ownershipState: 'archived',
      ownerPrincipal: principal100,
    }
    expect(
      recoveryChannelForAccount(record, makeAccount({ principal: { kind: 'user', telegramUserId: '200' } })),
    ).toBeNull()
  })

  it('uses the phone bridge for pre-principal archives without upgrading verification', () => {
    const record: StoredRecordOwnership = {
      ownershipState: 'archived',
      ownerAccountId: 'old-uuid',
      ownerAccountPhone: '+15550001',
    }
    expect(recoveryChannelForAccount(record, makeAccount())).toBe('phone-bridge')

    const recovered = recoverOwnership(normalizeOwnership(record), makeAccount(), 'phone-bridge')
    expect(recovered.lifecycle).toBe('active')
    // Recovery via phone must not silently claim verified ownership.
    expect(recovered.verification).toBe('unverified')
    expect(recovered.ownerPrincipal).toBeUndefined()
  })

  it('never recovers active records', () => {
    const record: StoredRecordOwnership = { ownershipState: 'owned', ownerPrincipal: principal100 }
    expect(recoveryChannelForAccount(record, makeAccount())).toBeNull()
  })

  it('phone bridge does not apply when the archive already has a principal', () => {
    const record: StoredRecordOwnership = {
      ownershipState: 'archived',
      ownerPrincipal: { kind: 'user', telegramUserId: '200' },
      ownerAccountPhone: '+15550001',
    }
    // Same phone, different identity: must not recover via the bridge.
    expect(recoveryChannelForAccount(record, makeAccount())).toBeNull()
  })
})

describe('archive + claim', () => {
  it('archives an owned record', () => {
    const archived = archiveOwnership(createOwnedOwnership(makeAccount()))
    expect(archived.lifecycle).toBe('archived')
    expect(archived.archivedAt).toBeInstanceOf(Date)
    expect(archived.archivedReason).toBe('account_removed')
  })

  it('does not re-archive an already-archived record (illegal transition is a no-op)', () => {
    const first = archiveOwnership(createOwnedOwnership(makeAccount()))
    const second = archiveOwnership(first, 'quota_cleanup')
    // The original archive metadata is preserved; the illegal repeat cannot reset it.
    expect(second).toBe(first)
    expect(second.archivedReason).toBe('account_removed')
  })

  it('claims a legacy record for the account', () => {
    const claimed = claimOwnership(normalizeOwnership({ ownershipState: 'legacy' }), makeAccount())
    expect(claimed).toMatchObject({ verification: 'verified', lifecycle: 'active', ownerAccountId: 'account-1' })
    expect(claimed.ownerPrincipal).toEqual(principal100)
  })

  it('does not inherit a foreign principal when a principal-less account claims a record', () => {
    // Reconciling a quarantined record that carries someone else's principal must bind to the
    // claiming account only, never resurrect an inconsistent unverified+principal shape.
    const quarantined = normalizeOwnership({
      ownerVerification: 'unverified',
      ownerPrincipal: { kind: 'user', telegramUserId: '999' },
    })
    const account = makeAccount({ id: 'local-only', principal: undefined })
    const claimed = claimOwnership(quarantined, account)

    expect(claimed.ownerPrincipal).toBeUndefined()
    expect(claimed.verification).toBe('unverified')
    expect(claimed.health).toBe('healthy')
    // The claimed record is now consistently owned/visible by the claiming account.
    expect(isOwnedByAccount(toStoredOwnership(claimed), account)).toBe(true)
  })
})

describe('access policy (canAccessContent / canManageRecord)', () => {
  const owner = makeAccount({ id: 'owner', principal: principal100 })
  const other = makeAccount({ id: 'other', principal: { kind: 'user', telegramUserId: '200' } })

  const ownedRecord: StoredRecordOwnership = {
    ownershipState: 'owned',
    ownerAccountId: 'owner',
    ownerPrincipal: principal100,
  }
  const archivedRecord: StoredRecordOwnership = {
    ownershipState: 'archived',
    ownerAccountId: 'owner',
    ownerPrincipal: principal100,
    ownerVerification: 'verified',
    lifecycle: 'archived',
  }
  const legacyRecord: StoredRecordOwnership = { ownershipState: 'legacy' }
  const quarantinedRecord: StoredRecordOwnership = {
    ownerVerification: 'legacy',
    ownerPrincipal: principal100,
  }

  it('grants content access only to the owner (or unclaimed legacy)', () => {
    expect(canAccessContent(ownedRecord, owner)).toBe(true)
    expect(canAccessContent(ownedRecord, other)).toBe(false)
    expect(canAccessContent(legacyRecord, other)).toBe(true)
    expect(canAccessContent(ownedRecord, null)).toBe(false)
  })

  it('never exposes archived or quarantined content to an active account', () => {
    expect(canAccessContent(archivedRecord, owner)).toBe(false)
    expect(canAccessContent(archivedRecord, other)).toBe(false)
    expect(canAccessContent(quarantinedRecord, owner)).toBe(false)
  })

  it('protects another active owner from management but allows orphan cleanup', () => {
    expect(canManageRecord(ownedRecord, owner)).toBe(true)
    expect(canManageRecord(ownedRecord, other)).toBe(false)
    // Orphaned records are manageable account-independently.
    expect(canManageRecord(archivedRecord, null)).toBe(true)
    expect(canManageRecord(quarantinedRecord, null)).toBe(true)
    expect(canManageRecord(legacyRecord, null)).toBe(true)
    // ...but a live account's active record is still protected from a null-context purge.
    expect(canManageRecord(ownedRecord, null)).toBe(false)
  })

  it('lets any active account delete an orphaned record owned by a different principal', () => {
    // Intended scope: orphaned inventory (archived/quarantined/legacy) is manageable by whoever is
    // present, since it never exposes content — only allows deletion. This locks that scope so a
    // future ownership tweak cannot silently start protecting orphans from cross-account cleanup.
    expect(canManageRecord(archivedRecord, other)).toBe(true)
    expect(canManageRecord(quarantinedRecord, other)).toBe(true)
    expect(canManageRecord(legacyRecord, other)).toBe(true)
    // Content of that archived record is still never readable by the other account.
    expect(canAccessContent(archivedRecord, other)).toBe(false)
  })
})
