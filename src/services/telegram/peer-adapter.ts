import type { Peer } from '@mtcute/web'
import type { PeerRef } from '@/types'

/** Return the unsigned MTProto ID, without mtcute's chat/channel marking. */
export function peerRawId(peer: Peer): string {
  if (peer.type === 'user') return String(peer.id)
  return peer.raw.id.toString()
}

export function peerKind(peer: Peer): PeerRef['kind'] {
  if (peer.type === 'user') return 'user'
  if (peer.chatType === 'channel') return 'channel'
  if (peer.chatType === 'group') return 'group'
  return 'supergroup'
}

/** Capture the access hash required to reopen a peer after the in-memory cache is gone. */
export function peerToPeerRef(peer: Peer): PeerRef {
  const accessHash =
    'accessHash' in peer.raw && peer.raw.accessHash ? peer.raw.accessHash.toString() : undefined

  return {
    kind: peerKind(peer),
    rawId: peerRawId(peer),
    ...(accessHash ? { accessHash } : {}),
  }
}
