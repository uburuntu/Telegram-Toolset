/**
 * Build a GramJS `Api.InputPeer*` directly from a canonical {@link PeerRef} (ARCHITECTURE.md §4).
 *
 * This is the payoff of storing an access hash: given a complete PeerRef, an input peer can be
 * constructed with no `getEntity` round-trip, so a chat can be re-opened after a cold start when its
 * id is not in the session's entity cache. Returns `null` when a required access hash is missing, so
 * the caller falls back to id-based resolution instead of sending a malformed peer.
 */

import { Api } from 'telegram'
import type { PeerRef } from '@/types'
import { peerRefToInputPeerParams } from './peer-resolver'

export function buildInputPeer(ref: PeerRef): Api.TypeInputPeer | null {
  const params = peerRefToInputPeerParams(ref)
  if (!params) {
    return null
  }

  switch (params.kind) {
    case 'user':
      return new Api.InputPeerUser({
        userId: BigInt(params.userId) as unknown as Api.long,
        accessHash: BigInt(params.accessHash) as unknown as Api.long,
      })
    case 'chat':
      return new Api.InputPeerChat({
        chatId: BigInt(params.chatId) as unknown as Api.long,
      })
    case 'channel':
      return new Api.InputPeerChannel({
        channelId: BigInt(params.channelId) as unknown as Api.long,
        accessHash: BigInt(params.accessHash) as unknown as Api.long,
      })
  }
}
