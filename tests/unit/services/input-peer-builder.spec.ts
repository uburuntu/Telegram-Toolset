import { describe, expect, it } from 'vitest'
import { buildInputPeer } from '@/services/telegram/input-peer-builder'

describe('buildInputPeer', () => {
  it('builds an mtcute input user from a user reference', () => {
    const peer = buildInputPeer({ kind: 'user', rawId: '123', accessHash: '456' })

    expect(peer?._).toBe('inputPeerUser')
    if (peer?._ !== 'inputPeerUser') throw new Error('Expected inputPeerUser')
    expect(peer.userId.toString()).toBe('123')
    expect(peer.accessHash.toString()).toBe('456')
  })

  it('builds input channels for channels and supergroups', () => {
    const channel = buildInputPeer({ kind: 'channel', rawId: '111', accessHash: '222' })
    const supergroup = buildInputPeer({ kind: 'supergroup', rawId: '333', accessHash: '444' })

    expect(channel?._).toBe('inputPeerChannel')
    expect(supergroup?._).toBe('inputPeerChannel')
    if (channel?._ !== 'inputPeerChannel' || supergroup?._ !== 'inputPeerChannel') {
      throw new Error('Expected inputPeerChannel')
    }
    expect(channel.channelId.toString()).toBe('111')
    expect(channel.accessHash.toString()).toBe('222')
    expect(supergroup.channelId.toString()).toBe('333')
  })

  it('builds a basic group without an access hash', () => {
    const peer = buildInputPeer({ kind: 'group', rawId: '789' })

    expect(peer?._).toBe('inputPeerChat')
    if (peer?._ !== 'inputPeerChat') throw new Error('Expected inputPeerChat')
    expect(peer.chatId.toString()).toBe('789')
  })

  it('rejects missing and zero access hashes where Telegram requires one', () => {
    expect(buildInputPeer({ kind: 'user', rawId: '1' })).toBeNull()
    expect(buildInputPeer({ kind: 'channel', rawId: '1' })).toBeNull()
    expect(buildInputPeer({ kind: 'supergroup', rawId: '1', accessHash: '0' })).toBeNull()
  })
})
