/**
 * Resolve a peer to a GramJS input peer, preferring warm-cache behavior and using a stored access
 * hash only as a cold-start fallback (ARCHITECTURE.md §4).
 *
 * The strategy is deliberately conservative so it does not change behavior for the common (warm)
 * case:
 * - A raw `bigint`/marked `string` resolves exactly as before (`getEntity` -> `getInputEntity`).
 * - A {@link PeerRef} first resolves through its stable marked id (identical to the pre-§4 path). Only
 *   if that throws — i.e. the entity is not in the session cache after a cold start — does it rebuild
 *   the input peer directly from the stored access hash. If no usable hash is stored, the original
 *   error propagates so the caller can route to explicit repair rather than acting on a bad peer.
 *
 * Dependencies are injected so the branching is unit-testable without a live GramJS client.
 */

import type { PeerRef } from '@/types'
import { isPeerRef, peerRefToMarkedId } from '@/utils/telegram-peers'
import { buildInputPeer } from './input-peer-builder'

export interface InputPeerResolverDeps {
  getEntity: (id: bigint | string) => Promise<unknown>
  getInputEntity: (entity: unknown) => Promise<unknown>
}

export async function resolveInputPeer(
  deps: InputPeerResolverDeps,
  peer: bigint | string | PeerRef,
): Promise<unknown> {
  if (!isPeerRef(peer)) {
    return deps.getInputEntity(await deps.getEntity(peer))
  }

  try {
    return await deps.getInputEntity(await deps.getEntity(peerRefToMarkedId(peer)))
  } catch (error) {
    const built = buildInputPeer(peer)
    if (built) {
      return built
    }
    throw error
  }
}
