import { describe, expect, it } from 'vitest'
import type { PeerRef } from '@/types'
import {
  isPeerRefComplete,
  peerRefToInputPeerParams,
  resolvePeer,
} from '@/services/telegram/peer-resolver'

const userWithHash: PeerRef = { kind: 'user', rawId: '123', accessHash: 'ah' }
const userNoHash: PeerRef = { kind: 'user', rawId: '123' }
const channelWithHash: PeerRef = { kind: 'channel', rawId: '456', accessHash: 'ah' }
const supergroupNoHash: PeerRef = { kind: 'supergroup', rawId: '456' }
const basicGroup: PeerRef = { kind: 'group', rawId: '789' }

describe('isPeerRefComplete', () => {
  it('requires an access hash for user/channel/supergroup but not for basic groups', () => {
    expect(isPeerRefComplete(userWithHash)).toBe(true)
    expect(isPeerRefComplete(channelWithHash)).toBe(true)
    expect(isPeerRefComplete(basicGroup)).toBe(true)
    expect(isPeerRefComplete(userNoHash)).toBe(false)
    expect(isPeerRefComplete(supergroupNoHash)).toBe(false)
    // An empty-string hash is treated as absent.
    expect(isPeerRefComplete({ kind: 'user', rawId: '1', accessHash: '' })).toBe(false)
    // A zero-valued hash is Telegram's "no hash" sentinel, so it is treated as absent too.
    expect(isPeerRefComplete({ kind: 'channel', rawId: '1', accessHash: '0' })).toBe(false)
  })
})

describe('resolvePeer', () => {
  it('is ready when the peerRef is complete', () => {
    expect(resolvePeer({ peerRef: userWithHash })).toEqual({ status: 'ready', peerRef: userWithHash })
    expect(resolvePeer({ peerRef: basicGroup })).toEqual({ status: 'ready', peerRef: basicGroup })
  })

  it('flags a known-kind peer whose access hash is missing for refresh', () => {
    expect(resolvePeer({ peerRef: userNoHash })).toEqual({
      status: 'needs-access-hash',
      peerRef: userNoHash,
    })
    expect(resolvePeer({ peerRef: supergroupNoHash })).toEqual({
      status: 'needs-access-hash',
      peerRef: supergroupNoHash,
    })
  })

  it('falls back to raw/marked ids for legacy records without inventing a kind', () => {
    // LLM export: has both raw and marked ids stored.
    expect(resolvePeer({ chatId: BigInt('456'), chatPeerId: '-100456' })).toEqual({
      status: 'needs-identification',
      rawId: '456',
      markedId: '-100456',
    })
    // Legacy backup: only a raw chatId, no marked id and no trustworthy kind.
    expect(resolvePeer({ chatId: BigInt('789') })).toEqual({
      status: 'needs-identification',
      rawId: '789',
      markedId: undefined,
    })
    // Nothing at all to go on.
    expect(resolvePeer({})).toEqual({
      status: 'needs-identification',
      rawId: undefined,
      markedId: undefined,
    })
  })

  it('prefers the peerRef even when legacy ids are also present', () => {
    expect(
      resolvePeer({ peerRef: channelWithHash, chatId: BigInt('999'), chatPeerId: '-100999' }),
    ).toEqual({ status: 'ready', peerRef: channelWithHash })
  })
})

describe('peerRefToInputPeerParams', () => {
  it('builds user/channel params when the access hash is present', () => {
    expect(peerRefToInputPeerParams(userWithHash)).toEqual({
      kind: 'user',
      userId: '123',
      accessHash: 'ah',
    })
    expect(peerRefToInputPeerParams(channelWithHash)).toEqual({
      kind: 'channel',
      channelId: '456',
      accessHash: 'ah',
    })
  })

  it('builds chat params for a basic group with no access hash', () => {
    expect(peerRefToInputPeerParams(basicGroup)).toEqual({ kind: 'chat', chatId: '789' })
  })

  it('returns null when a required access hash is missing', () => {
    expect(peerRefToInputPeerParams(userNoHash)).toBeNull()
    expect(peerRefToInputPeerParams(supergroupNoHash)).toBeNull()
    // A zero-valued (sentinel) hash is not usable, so it also yields no params.
    expect(peerRefToInputPeerParams({ kind: 'channel', rawId: '1', accessHash: '0' })).toBeNull()
  })
})
