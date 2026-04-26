export type StoredRecordOwnershipState = 'owned' | 'archived' | 'legacy'

export type StoredRecordArchiveReason = 'account_removed'

export interface StoredRecordOwnership {
  ownerAccountId?: string
  ownerAccountPhone?: string
  ownershipState?: StoredRecordOwnershipState
  archivedAt?: Date
  archivedReason?: StoredRecordArchiveReason
}
