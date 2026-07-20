import type { ChatExport, ChatInfo, PeerRef } from '@/types'

export type TelegramPeerKind = 'user' | 'chat' | 'channel'

/** The entity-granularity kind carried by {@link PeerRef} (distinguishes supergroup from channel). */
export type PeerRefKind = PeerRef['kind']

/** Coerce an id to its unsigned decimal string, stripping a single leading sign if present. */
export function normalizeNumericId(id: bigint | number | string): string {
  const value = typeof id === 'bigint' ? id.toString() : String(id)
  return value.startsWith('-') ? value.slice(1) : value
}

export function buildMarkedPeerId(kind: TelegramPeerKind, id: bigint | number | string): string {
  const normalizedId = normalizeNumericId(id)

  switch (kind) {
    case 'user':
      return normalizedId
    case 'chat':
      return `-${normalizedId}`
    case 'channel':
      return `-100${normalizedId}`
  }
}

export function parseMarkedPeerId(peerId: bigint | number | string): {
  id: string
  kind: TelegramPeerKind
  markedId: string
} {
  const markedId = typeof peerId === 'bigint' ? peerId.toString() : String(peerId)

  if (!markedId.startsWith('-')) {
    return {
      id: markedId,
      kind: 'user',
      markedId,
    }
  }

  const channelMatch = markedId.match(/^-100([^0]\d*)$/)
  if (channelMatch?.[1]) {
    return {
      id: channelMatch[1],
      kind: 'channel',
      markedId,
    }
  }

  return {
    id: markedId.slice(1),
    kind: 'chat',
    markedId,
  }
}

export function getPeerKindFromChatType(
  chatType: ChatInfo['type'] | ChatExport['chatType'],
): TelegramPeerKind {
  switch (chatType) {
    case 'user':
      return 'user'
    case 'group':
      return 'chat'
    case 'channel':
    case 'supergroup':
      return 'channel'
  }
}

export function getMarkedPeerIdForChat(
  chatId: bigint | number | string,
  chatType: ChatInfo['type'] | ChatExport['chatType'],
): string {
  return buildMarkedPeerId(getPeerKindFromChatType(chatType), chatId)
}

export function normalizeMarkedPeerId(
  peerId?: bigint | number | string | null,
): string | undefined {
  if (peerId === null || peerId === undefined) {
    return undefined
  }

  return parseMarkedPeerId(peerId).markedId
}

// =============================================================================
// PeerRef — the canonical, storable peer reference.
//
// PeerRef.kind and the ChatInfo/ChatExport/Backup `chatType` union are the same four values, so
// conversion between them is a direct passthrough. The `-100…` marked form is shared by supergroup
// and channel, which is exactly why PeerRef carries the entity-derived kind separately from the id.
// =============================================================================

/** Collapse the four-way {@link PeerRefKind} down to the three marked-id families. */
export function peerKindToMarkedKind(kind: PeerRefKind): TelegramPeerKind {
  switch (kind) {
    case 'user':
      return 'user'
    case 'group':
      return 'chat'
    case 'supergroup':
    case 'channel':
      return 'channel'
  }
}

/**
 * Build a {@link PeerRef} from an entity-granularity chat type plus a raw (unsigned) id. This is the
 * reliable constructor: because `chatType` already distinguishes supergroup from channel, no peer-type
 * guessing is involved. A leading sign on `rawId` is defensively stripped, but callers should pass
 * the unsigned raw entity id, not a marked id.
 */
export function createPeerRef(
  kind: PeerRefKind,
  rawId: bigint | number | string,
  accessHash?: bigint | number | string | null,
): PeerRef {
  const ref: PeerRef = { kind, rawId: normalizeNumericId(rawId) }
  if (accessHash !== undefined && accessHash !== null) {
    const normalizedHash = String(accessHash)
    // A zero-valued access hash is Telegram's "no hash" sentinel, not a usable hash; omit it so
    // completeness checks route to resolution/repair instead of emitting an invalid input peer.
    if (normalizedHash.length > 0 && normalizedHash !== '0') {
      ref.accessHash = normalizedHash
    }
  }
  return ref
}

/** Derive the Bot API-style marked id for a {@link PeerRef}. */
export function peerRefToMarkedId(ref: PeerRef): string {
  return buildMarkedPeerId(peerKindToMarkedKind(ref.kind), ref.rawId)
}

/** The unsigned raw id of a {@link PeerRef} as a `bigint` (for GramJS calls that still take one). */
export function peerRefRawBigInt(ref: PeerRef): bigint {
  return BigInt(ref.rawId)
}

/**
 * Structural equality for two peer references. Access hash is compared only when both sides carry one,
 * so a freshly resolved hash does not make an otherwise-identical peer compare unequal.
 */
export function arePeerRefsEqual(a: PeerRef, b: PeerRef): boolean {
  if (a.kind !== b.kind || a.rawId !== b.rawId) {
    return false
  }
  if (a.accessHash !== undefined && b.accessHash !== undefined) {
    return a.accessHash === b.accessHash
  }
  return true
}

/** Whether a peer kind needs an access hash to reconstruct an input peer after a cold start. */
export function peerKindRequiresAccessHash(kind: PeerRefKind): boolean {
  return kind !== 'group'
}

/** The four entity-granularity kinds a {@link PeerRef} may carry. */
const PEER_REF_KINDS: ReadonlySet<PeerRefKind> = new Set(['user', 'group', 'supergroup', 'channel'])

/** Narrow a `bigint | string | PeerRef` union to a {@link PeerRef}. */
export function isPeerRef(value: unknown): value is PeerRef {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { kind?: unknown; rawId?: unknown }
  return (
    typeof candidate.rawId === 'string' &&
    typeof candidate.kind === 'string' &&
    PEER_REF_KINDS.has(candidate.kind as PeerRefKind)
  )
}
