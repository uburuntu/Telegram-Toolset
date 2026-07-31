import { Long, type tl } from '@mtcute/web'
import type { PeerRef } from '@/types'

function parsePeerId(value: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid Telegram peer ID: ${value}`)
  }
  return id
}

/** Build an mtcute input peer from a complete, storable peer reference. */
export function buildInputPeer(ref: PeerRef): tl.TypeInputPeer | null {
  if (ref.kind === 'group') {
    return { _: 'inputPeerChat', chatId: parsePeerId(ref.rawId) }
  }
  if (!ref.accessHash || ref.accessHash === '0') return null

  if (ref.kind === 'user') {
    return {
      _: 'inputPeerUser',
      userId: parsePeerId(ref.rawId),
      accessHash: Long.fromString(ref.accessHash),
    }
  }

  return {
    _: 'inputPeerChannel',
    channelId: parsePeerId(ref.rawId),
    accessHash: Long.fromString(ref.accessHash),
  }
}
