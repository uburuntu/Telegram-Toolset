import { describe, expect, it } from 'vitest'
import {
  buildMarkedPeerId,
  getMarkedPeerIdForChat,
  getPeerKindFromChatType,
  normalizeMarkedPeerId,
  parseMarkedPeerId,
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
