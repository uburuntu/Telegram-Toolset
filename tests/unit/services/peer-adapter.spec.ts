import { Long } from '@mtcute/web'
import { describe, expect, it } from 'vitest'
import { peerKind, peerRawId, peerToPeerRef } from '@/services/telegram/peer-adapter'
import { peerRefToMarkedId } from '@/utils/telegram-peers'

const user = {
  type: 'user',
  id: 123456,
  raw: { _: 'user', id: Long.fromNumber(123456), accessHash: Long.fromString('111222333') },
}

const group = {
  type: 'chat',
  id: -444,
  chatType: 'group',
  raw: { _: 'chat', id: Long.fromNumber(444) },
}

const supergroup = {
  type: 'chat',
  id: -1001234567890,
  chatType: 'supergroup',
  raw: {
    _: 'channel',
    id: Long.fromString('1234567890'),
    accessHash: Long.fromNumber(7777),
  },
}

const channel = {
  type: 'chat',
  id: -100987654321,
  chatType: 'channel',
  raw: {
    _: 'channel',
    id: Long.fromString('987654321'),
    accessHash: Long.fromNumber(8888),
  },
}

describe('mtcute peer adapter', () => {
  it('preserves peer kind and unsigned raw ID', () => {
    expect(peerKind(user as never)).toBe('user')
    expect(peerKind(group as never)).toBe('group')
    expect(peerKind(supergroup as never)).toBe('supergroup')
    expect(peerKind(channel as never)).toBe('channel')
    expect(peerRawId(supergroup as never)).toBe('1234567890')
  })

  it('captures access hashes for cold-start resolution', () => {
    expect(peerToPeerRef(user as never)).toEqual({
      kind: 'user',
      rawId: '123456',
      accessHash: '111222333',
    })
    expect(peerToPeerRef(group as never)).toEqual({ kind: 'group', rawId: '444' })
    expect(peerToPeerRef(supergroup as never)).toEqual({
      kind: 'supergroup',
      rawId: '1234567890',
      accessHash: '7777',
    })
    expect(peerToPeerRef(channel as never)).toEqual({
      kind: 'channel',
      rawId: '987654321',
      accessHash: '8888',
    })
  })

  it('round-trips channel-family references to marked IDs', () => {
    expect(peerRefToMarkedId(peerToPeerRef(supergroup as never))).toBe('-1001234567890')
    expect(peerRefToMarkedId(peerToPeerRef(channel as never))).toBe('-100987654321')
  })
})
