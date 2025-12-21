/**
 * Unit tests for message serialization utilities
 */

import { describe, it, expect } from 'vitest'
import {
  stripRawMessage,
  stripRawMessages,
  safeJsonStringify,
} from '@/utils/message-serialization'
import type { DeletedMessage } from '@/types'

describe('stripRawMessage', () => {
  it('removes _rawMessage field from a message', () => {
    const msg: DeletedMessage = {
      id: 1,
      chatId: BigInt('123456789'),
      date: new Date('2024-01-15'),
      hasMedia: false,
      _rawMessage: { some: 'gramjs object' },
    }

    const result = stripRawMessage(msg)

    expect(result).not.toHaveProperty('_rawMessage')
    expect(result.id).toBe(1)
    expect(result.chatId).toBe(BigInt('123456789'))
  })

  it('works when _rawMessage is undefined', () => {
    const msg: DeletedMessage = {
      id: 2,
      chatId: BigInt('987654321'),
      date: new Date('2024-01-16'),
      hasMedia: true,
    }

    const result = stripRawMessage(msg)

    expect(result).not.toHaveProperty('_rawMessage')
    expect(result.id).toBe(2)
  })

  it('preserves all other fields', () => {
    const msg: DeletedMessage = {
      id: 3,
      chatId: BigInt('111222333'),
      senderId: BigInt('444555666'),
      senderName: 'Alice',
      senderUsername: 'alice',
      text: 'Hello world',
      date: new Date('2024-01-17'),
      hasMedia: true,
      mediaType: 'photo',
      mediaFilename: 'photo.jpg',
      mediaSize: 1024,
      _rawMessage: { big: 'object' },
    }

    const result = stripRawMessage(msg)

    expect(result.id).toBe(3)
    expect(result.chatId).toBe(BigInt('111222333'))
    expect(result.senderId).toBe(BigInt('444555666'))
    expect(result.senderName).toBe('Alice')
    expect(result.senderUsername).toBe('alice')
    expect(result.text).toBe('Hello world')
    expect(result.hasMedia).toBe(true)
    expect(result.mediaType).toBe('photo')
    expect(result.mediaFilename).toBe('photo.jpg')
    expect(result.mediaSize).toBe(1024)
    expect(result).not.toHaveProperty('_rawMessage')
  })
})

describe('stripRawMessages', () => {
  it('strips _rawMessage from all messages in an array', () => {
    const messages: DeletedMessage[] = [
      {
        id: 1,
        chatId: BigInt('123'),
        date: new Date(),
        hasMedia: false,
        _rawMessage: { a: 1 },
      },
      {
        id: 2,
        chatId: BigInt('456'),
        date: new Date(),
        hasMedia: false,
        _rawMessage: { b: 2 },
      },
      {
        id: 3,
        chatId: BigInt('789'),
        date: new Date(),
        hasMedia: false,
        // No _rawMessage
      },
    ]

    const results = stripRawMessages(messages)

    expect(results).toHaveLength(3)
    results.forEach((msg) => {
      expect(msg).not.toHaveProperty('_rawMessage')
    })
    expect(results[0]?.id).toBe(1)
    expect(results[1]?.id).toBe(2)
    expect(results[2]?.id).toBe(3)
  })

  it('returns empty array for empty input', () => {
    expect(stripRawMessages([])).toEqual([])
  })
})

describe('safeJsonStringify', () => {
  it('serializes regular objects normally', () => {
    const obj = { name: 'test', value: 42 }
    const result = safeJsonStringify(obj)
    expect(result).toBe('{"name":"test","value":42}')
  })

  it('converts BigInt to string', () => {
    const obj = { id: BigInt('9007199254740993') }
    const result = safeJsonStringify(obj)
    expect(result).toBe('{"id":"9007199254740993"}')
  })

  it('handles nested BigInt values', () => {
    const obj = {
      message: {
        chatId: BigInt('123456789'),
        senderId: BigInt('987654321'),
      },
    }
    const result = safeJsonStringify(obj)
    expect(result).toBe('{"message":{"chatId":"123456789","senderId":"987654321"}}')
  })

  it('handles arrays with BigInt', () => {
    const arr = [BigInt('111'), BigInt('222'), BigInt('333')]
    const result = safeJsonStringify(arr)
    expect(result).toBe('["111","222","333"]')
  })

  it('supports space parameter for formatting', () => {
    const obj = { a: 1 }
    const result = safeJsonStringify(obj, 2)
    expect(result).toBe('{\n  "a": 1\n}')
  })

  it('handles mixed types correctly', () => {
    const obj = {
      string: 'hello',
      number: 42,
      bigint: BigInt('999'),
      boolean: true,
      null: null,
      array: [1, BigInt('2'), 'three'],
    }
    const result = JSON.parse(safeJsonStringify(obj))
    expect(result.string).toBe('hello')
    expect(result.number).toBe(42)
    expect(result.bigint).toBe('999')
    expect(result.boolean).toBe(true)
    expect(result.null).toBeNull()
    expect(result.array).toEqual([1, '2', 'three'])
  })
})

