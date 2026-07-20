import { describe, expect, it } from 'vitest'
import { entityKind, entityToPeerRef } from '@/services/telegram/peer-adapter'
import { peerRefToMarkedId } from '@/utils/telegram-peers'

/**
 * Production-shaped GramJS entity fixtures. Real entities carry bigint ids/access hashes and the
 * structural flags GramJS sets; the adapter must classify them without a `className`.
 */
const userEntity = {
  className: 'User',
  id: BigInt('123456'),
  accessHash: BigInt('111222333'),
  firstName: 'Ada',
  lastName: 'Lovelace',
  username: 'ada',
}

const deletedUserEntity = {
  // A deleted account keeps className + id + access hash but loses name/username fields.
  className: 'User',
  id: BigInt('555'),
  accessHash: BigInt('999'),
}

const basicGroupEntity = {
  // A basic group (Chat) has a title but no access hash and no channel flags.
  className: 'Chat',
  id: BigInt('444'),
  title: 'Weekend Trip',
}

const supergroupEntity = {
  className: 'Channel',
  id: BigInt('1234567890'),
  accessHash: BigInt('7777'),
  title: 'Dev Chat',
  megagroup: true,
}

const broadcastChannelEntity = {
  className: 'Channel',
  id: BigInt('987654321'),
  accessHash: BigInt('8888'),
  title: 'Announcements',
  broadcast: true,
}

describe('entityKind', () => {
  it('classifies each production-shaped entity, testing channel flags before the title fallback', () => {
    expect(entityKind(userEntity)).toBe('user')
    expect(entityKind(deletedUserEntity)).toBe('user')
    expect(entityKind(basicGroupEntity)).toBe('group')
    expect(entityKind(supergroupEntity)).toBe('supergroup')
    expect(entityKind(broadcastChannelEntity)).toBe('channel')
    // gigagroup (a supergroup that outgrew the member cap) is also a supergroup.
    expect(entityKind({ className: 'Channel', id: BigInt('1'), title: 'Big', gigagroup: true })).toBe(
      'supergroup',
    )
  })

  it('falls back to structural fields when no className is present', () => {
    expect(entityKind({ id: BigInt('1'), firstName: 'No ClassName' })).toBe('user')
    expect(entityKind({ id: BigInt('1'), title: 'Group' })).toBe('group')
    expect(entityKind({ id: BigInt('1'), broadcast: true })).toBe('channel')
    expect(entityKind({ id: BigInt('1'), megagroup: true })).toBe('supergroup')
  })

  it('returns null for an unrecognizable or non-object entity', () => {
    expect(entityKind(null)).toBeNull()
    expect(entityKind(undefined)).toBeNull()
    expect(entityKind(42)).toBeNull()
    // No className and no distinguishing field: cannot classify without guessing.
    expect(entityKind({ id: BigInt('1') })).toBeNull()
    expect(entityKind({ id: BigInt('1'), accessHash: BigInt('2') })).toBeNull()
  })
})

describe('entityToPeerRef', () => {
  it('captures kind, unsigned raw id, and access hash for a user', () => {
    expect(entityToPeerRef(userEntity)).toEqual({
      kind: 'user',
      rawId: '123456',
      accessHash: '111222333',
    })
    expect(entityToPeerRef(deletedUserEntity)).toEqual({
      kind: 'user',
      rawId: '555',
      accessHash: '999',
    })
  })

  it('omits the access hash for a basic group (InputPeerChat needs only the id)', () => {
    expect(entityToPeerRef(basicGroupEntity)).toEqual({ kind: 'group', rawId: '444' })
  })

  it('distinguishes supergroup from channel even though both derive the same marked id', () => {
    const supergroup = entityToPeerRef(supergroupEntity)
    const channel = entityToPeerRef(broadcastChannelEntity)
    expect(supergroup).toEqual({ kind: 'supergroup', rawId: '1234567890', accessHash: '7777' })
    expect(channel).toEqual({ kind: 'channel', rawId: '987654321', accessHash: '8888' })
    // The marked id round-trips to the legacy -100 form for both.
    expect(peerRefToMarkedId(supergroup!)).toBe('-1001234567890')
    expect(peerRefToMarkedId(channel!)).toBe('-100987654321')
  })

  it('returns null when the entity has no id or no recognizable kind', () => {
    expect(entityToPeerRef(null)).toBeNull()
    expect(entityToPeerRef({ accessHash: BigInt('1') })).toBeNull()
    expect(entityToPeerRef({ id: BigInt('1') })).toBeNull()
  })
})
