import { describe, expect, it } from 'vitest'
import {
  arePeerRefsEqual,
  buildMarkedPeerId,
  createPeerRef,
  getMarkedPeerIdForChat,
  getPeerKindFromChatType,
  normalizeMarkedPeerId,
  parseMarkedPeerId,
  peerKindRequiresAccessHash,
  peerKindToMarkedKind,
  peerRefRawBigInt,
  peerRefToMarkedId,
} from '@/utils/telegram-peers'

describe('telegram peer utilities', () => {
  it('builds marked peer ids for all peer kinds', () => {
    expect(buildMarkedPeerId('user', 123456)).toBe('123456')
    expect(buildMarkedPeerId('chat', BigInt('123456'))).toBe('-123456')
    expect(buildMarkedPeerId('channel', '-123456')).toBe('-100123456')
  })

  it('parses marked peer ids for users, chats, and channels', () => {
    expect(parseMarkedPeerId('123456')).toEqual({
      id: '123456',
      kind: 'user',
      markedId: '123456',
    })

    expect(parseMarkedPeerId('-123456')).toEqual({
      id: '123456',
      kind: 'chat',
      markedId: '-123456',
    })

    expect(parseMarkedPeerId(BigInt('-100123456'))).toEqual({
      id: '123456',
      kind: 'channel',
      markedId: '-100123456',
    })
  })

  it('maps chat types to peer kinds and composes marked ids', () => {
    expect(getPeerKindFromChatType('user')).toBe('user')
    expect(getPeerKindFromChatType('group')).toBe('chat')
    expect(getPeerKindFromChatType('channel')).toBe('channel')
    expect(getPeerKindFromChatType('supergroup')).toBe('channel')

    expect(getMarkedPeerIdForChat(123456, 'group')).toBe('-123456')
    expect(getMarkedPeerIdForChat(BigInt('123456'), 'supergroup')).toBe('-100123456')
  })

  it('normalizes optional marked peer ids', () => {
    expect(normalizeMarkedPeerId(undefined)).toBeUndefined()
    expect(normalizeMarkedPeerId(null)).toBeUndefined()
    expect(normalizeMarkedPeerId('-100123456')).toBe('-100123456')
    expect(normalizeMarkedPeerId(BigInt('-123456'))).toBe('-123456')
  })
})

describe('PeerRef conversions', () => {
  it('collapses the four-way kind to the three marked families', () => {
    expect(peerKindToMarkedKind('user')).toBe('user')
    expect(peerKindToMarkedKind('group')).toBe('chat')
    expect(peerKindToMarkedKind('supergroup')).toBe('channel')
    expect(peerKindToMarkedKind('channel')).toBe('channel')
  })

  it('creates a normalized PeerRef and only stores a non-empty access hash', () => {
    expect(createPeerRef('channel', BigInt('123456'), BigInt('987654'))).toEqual({
      kind: 'channel',
      rawId: '123456',
      accessHash: '987654',
    })
    // A defensively signed raw id is stripped to its unsigned form.
    expect(createPeerRef('group', '-123456')).toEqual({ kind: 'group', rawId: '123456' })
    // Absent/empty access hashes are omitted rather than stored as '' or 'null'.
    expect(createPeerRef('user', 42, null).accessHash).toBeUndefined()
    expect(createPeerRef('user', 42, '').accessHash).toBeUndefined()
    expect(createPeerRef('user', 42).accessHash).toBeUndefined()
  })

  it('derives marked ids from a PeerRef, disambiguating supergroup vs channel identically', () => {
    // Supergroup and channel share the -100 marked form; the distinction lives in `kind`.
    expect(peerRefToMarkedId({ kind: 'supergroup', rawId: '123456' })).toBe('-100123456')
    expect(peerRefToMarkedId({ kind: 'channel', rawId: '123456' })).toBe('-100123456')
    expect(peerRefToMarkedId({ kind: 'group', rawId: '123456' })).toBe('-123456')
    expect(peerRefToMarkedId({ kind: 'user', rawId: '123456' })).toBe('123456')
  })

  it('exposes the raw id as a bigint', () => {
    expect(peerRefRawBigInt({ kind: 'channel', rawId: '123456' })).toBe(BigInt('123456'))
  })

  it('treats peers as equal by kind and raw id, tolerating a not-yet-resolved access hash', () => {
    const a: import('@/types').PeerRef = { kind: 'channel', rawId: '1', accessHash: 'h1' }
    expect(arePeerRefsEqual(a, { kind: 'channel', rawId: '1', accessHash: 'h1' })).toBe(true)
    // One side missing the hash still matches (it can be resolved later).
    expect(arePeerRefsEqual(a, { kind: 'channel', rawId: '1' })).toBe(true)
    // A genuinely different hash on both sides does not match.
    expect(arePeerRefsEqual(a, { kind: 'channel', rawId: '1', accessHash: 'h2' })).toBe(false)
    // Different kind or id never matches, even when the marked id would collide.
    expect(arePeerRefsEqual(a, { kind: 'supergroup', rawId: '1', accessHash: 'h1' })).toBe(false)
    expect(arePeerRefsEqual(a, { kind: 'channel', rawId: '2', accessHash: 'h1' })).toBe(false)
  })

  it('knows which kinds require an access hash for cold-start reconstruction', () => {
    expect(peerKindRequiresAccessHash('user')).toBe(true)
    expect(peerKindRequiresAccessHash('channel')).toBe(true)
    expect(peerKindRequiresAccessHash('supergroup')).toBe(true)
    // Basic groups use InputPeerChat, which needs only the chat id.
    expect(peerKindRequiresAccessHash('group')).toBe(false)
  })
})
