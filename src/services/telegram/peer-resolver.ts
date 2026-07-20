/**
 * Turning a stored record into something the Telegram layer can act on.
 *
 * Records accumulated over three schema eras:
 * - Newer records carry a full {@link PeerRef} (kind + raw id + access hash).
 * - Newer records for basic groups, or entities Telegram returned without a hash, carry a PeerRef whose
 *   `accessHash` is absent.
 * - Older records carry only a raw `chatId` (and sometimes a marked `chatPeerId`), with no reliable
 *   kind — the legacy backup path even hardcoded `chatType: 'channel'`.
 *
 * {@link resolvePeer} maps those into a typed decision so callers can build an input peer directly,
 * refresh a missing access hash, or route to explicit repair — but never guess a peer's kind from an
 * ambiguous marked id.
 */

import type { PeerRef } from '@/types'
import { normalizeNumericId, peerKindRequiresAccessHash } from '@/utils/telegram-peers'

/** A stored record's peer identity, as much of it as the record happens to carry. */
export interface StoredPeerIdentity {
  peerRef?: PeerRef
  /** Raw (unsigned) chat id present on every record. */
  chatId?: bigint | number | string | null
  /** Bot API-style marked id, when the record stored one (LLM exports do). */
  chatPeerId?: bigint | number | string | null
}

export type PeerResolution =
  /** Complete: an input peer can be built directly with no network round-trip. */
  | { status: 'ready'; peerRef: PeerRef }
  /** Kind is known but the access hash is missing; refresh it via the entity, then repair the record. */
  | { status: 'needs-access-hash'; peerRef: PeerRef }
  /** No canonical reference: resolve the raw/marked id via Telegram, then repair — no kind guessing. */
  | { status: 'needs-identification'; rawId?: string; markedId?: string }

function hasAccessHash(ref: PeerRef): boolean {
  // A zero-valued hash is Telegram's "no hash" sentinel, not a usable access hash, so treat it as
  // missing and route to resolution/repair rather than building an invalid input peer.
  return typeof ref.accessHash === 'string' && ref.accessHash.length > 0 && ref.accessHash !== '0'
}

/** Whether a {@link PeerRef} carries everything needed to build an input peer without the network. */
export function isPeerRefComplete(ref: PeerRef): boolean {
  return !peerKindRequiresAccessHash(ref.kind) || hasAccessHash(ref)
}

/**
 * Decide how to obtain a usable peer for a stored record. Prefers the canonical {@link PeerRef};
 * falls back to the raw/marked id for legacy records without inventing a kind.
 */
export function resolvePeer(identity: StoredPeerIdentity): PeerResolution {
  const ref = identity.peerRef
  if (ref) {
    return isPeerRefComplete(ref)
      ? { status: 'ready', peerRef: ref }
      : { status: 'needs-access-hash', peerRef: ref }
  }

  const rawId = identity.chatId != null ? normalizeNumericId(identity.chatId) : undefined
  const markedId = identity.chatPeerId != null ? String(identity.chatPeerId) : undefined
  return { status: 'needs-identification', rawId, markedId }
}

/** Plain parameters for constructing a GramJS `Api.InputPeer*` from a complete {@link PeerRef}. */
export type InputPeerParams =
  | { kind: 'user'; userId: string; accessHash: string }
  | { kind: 'chat'; chatId: string }
  | { kind: 'channel'; channelId: string; accessHash: string }

/**
 * Map a {@link PeerRef} to the parameters for a GramJS input peer, or `null` when a required access
 * hash is missing. The caller (the browser client adapter) turns these into `Api.InputPeer*` objects;
 * keeping the mapping pure makes it unit-testable without GramJS.
 */
export function peerRefToInputPeerParams(ref: PeerRef): InputPeerParams | null {
  switch (ref.kind) {
    case 'user':
      return hasAccessHash(ref)
        ? { kind: 'user', userId: ref.rawId, accessHash: ref.accessHash as string }
        : null
    case 'group':
      // Basic groups use InputPeerChat, which needs only the chat id.
      return { kind: 'chat', chatId: ref.rawId }
    case 'supergroup':
    case 'channel':
      return hasAccessHash(ref)
        ? { kind: 'channel', channelId: ref.rawId, accessHash: ref.accessHash as string }
        : null
  }
}
