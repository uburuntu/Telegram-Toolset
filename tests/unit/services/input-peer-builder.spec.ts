import { Api } from 'telegram'
import { describe, expect, it } from 'vitest'
import type { PeerRef } from '@/types'
import { buildInputPeer } from '@/services/telegram/input-peer-builder'

describe('buildInputPeer', () => {
  it('builds an InputPeerUser from a user PeerRef with an access hash', () => {
    const ref: PeerRef = { kind: 'user', rawId: '123', accessHash: '456' }
    const peer = buildInputPeer(ref)
    expect(peer).toBeInstanceOf(Api.InputPeerUser)
    const user = peer as Api.InputPeerUser
    expect(user.userId).toBe(BigInt('123'))
    expect(user.accessHash).toBe(BigInt('456'))
  })

  it('builds an InputPeerChannel for both channels and supergroups', () => {
    const channel = buildInputPeer({ kind: 'channel', rawId: '111', accessHash: '222' })
    const supergroup = buildInputPeer({ kind: 'supergroup', rawId: '333', accessHash: '444' })
    expect(channel).toBeInstanceOf(Api.InputPeerChannel)
    expect(supergroup).toBeInstanceOf(Api.InputPeerChannel)
    expect((channel as Api.InputPeerChannel).channelId).toBe(BigInt('111'))
    expect((channel as Api.InputPeerChannel).accessHash).toBe(BigInt('222'))
    expect((supergroup as Api.InputPeerChannel).channelId).toBe(BigInt('333'))
  })

  it('builds an InputPeerChat for a basic group without an access hash', () => {
    const peer = buildInputPeer({ kind: 'group', rawId: '789' })
    expect(peer).toBeInstanceOf(Api.InputPeerChat)
    expect((peer as Api.InputPeerChat).chatId).toBe(BigInt('789'))
  })

  it('returns null when a required access hash is missing', () => {
    expect(buildInputPeer({ kind: 'user', rawId: '1' })).toBeNull()
    expect(buildInputPeer({ kind: 'channel', rawId: '1' })).toBeNull()
    expect(buildInputPeer({ kind: 'supergroup', rawId: '1' })).toBeNull()
  })
})
