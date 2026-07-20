/**
 * The single adapter between GramJS runtime entities and the app's canonical {@link PeerRef}.
 * All GramJS entity-shape inspection for peer identity lives here so the rest
 * of the app never re-derives peer kind, raw id, or access hash from opaque GramJS objects.
 *
 * GramJS entity shapes (structural, since the browser build's types are loose):
 * - `User`:   { className: 'User', id, accessHash?, firstName?, lastName?, username? }
 * - `Chat`:   { className: 'Chat', id, title }           — a basic group, has no access hash
 * - `Channel`:{ className: 'Channel', id, accessHash?, title, broadcast?, megagroup?, gigagroup? }
 *
 * A `Channel` with `broadcast` is a broadcast channel; with `megagroup`/`gigagroup` it is a
 * supergroup. That distinction is only available from the entity, never from a marked id, which is
 * why {@link entityToPeerRef} is the authority for {@link PeerRef.kind}. `className` is the reliable
 * discriminator for entities that have lost their descriptive fields (e.g. a deleted-account user);
 * the structural flags/fields remain as a fallback for looser fixtures.
 */

import type { PeerRef } from '@/types'
import { createPeerRef } from '@/utils/telegram-peers'

interface GramJsEntityLike {
  className?: unknown
  id?: unknown
  accessHash?: unknown
  broadcast?: unknown
  megagroup?: unknown
  gigagroup?: unknown
  title?: unknown
  firstName?: unknown
  lastName?: unknown
  username?: unknown
}

function asEntity(entity: unknown): GramJsEntityLike | null {
  if (!entity || typeof entity !== 'object') {
    return null
  }
  return entity as GramJsEntityLike
}

/**
 * Classify a GramJS entity into a {@link PeerRef.kind}, or `null` when the shape is unrecognizable.
 * The check order matters: a `Channel` carries both channel/supergroup flags and a `title`, so the
 * broadcast/megagroup/gigagroup flags must be tested before the `title` (basic-group) fallback.
 */
export function entityKind(entity: unknown): PeerRef['kind'] | null {
  const value = asEntity(entity)
  if (!value) {
    return null
  }

  // Channel-family flags are the strongest signal and are checked first: a Channel entity also has a
  // `title`, so testing `title` before them would misclassify every channel/supergroup as a group.
  if (value.broadcast) {
    return 'channel'
  }
  if (value.megagroup || 'gigagroup' in value) {
    return 'supergroup'
  }

  // `className` reliably classifies entities that lost their descriptive fields.
  const className = typeof value.className === 'string' ? value.className : ''
  if (className === 'Channel' || className === 'ChannelForbidden') {
    return 'channel'
  }
  if (className === 'Chat' || className === 'ChatForbidden') {
    return 'group'
  }
  if (className === 'User' || className === 'UserEmpty') {
    return 'user'
  }

  // Structural fallback for looser fixtures without a className.
  if ('title' in value) {
    return 'group'
  }
  if ('firstName' in value || 'lastName' in value || 'username' in value) {
    return 'user'
  }
  return null
}

/**
 * Convert a GramJS entity into a canonical {@link PeerRef}, capturing the access hash needed to
 * reconstruct an input peer after a cold start. Returns `null` when the entity has no id or an
 * unrecognizable kind, so callers can route it through the explicit resolver/repair path instead of
 * guessing.
 */
export function entityToPeerRef(entity: unknown): PeerRef | null {
  const value = asEntity(entity)
  if (!value || value.id === undefined || value.id === null) {
    return null
  }

  const kind = entityKind(value)
  if (!kind) {
    return null
  }

  const rawId = value.id as bigint | number | string
  const accessHash = value.accessHash as bigint | number | string | null | undefined
  return createPeerRef(kind, rawId, accessHash)
}
