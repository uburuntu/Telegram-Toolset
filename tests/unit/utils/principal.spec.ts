import { describe, expect, it } from 'vitest'
import {
  accountTypeForPrincipal,
  createBotPrincipal,
  createPrincipal,
  createUserPrincipal,
  isTelegramPrincipal,
  normalizeTelegramUserId,
  parsePrincipalKey,
  principalKey,
  principalsMatch,
} from '@/utils/principal'

describe('normalizeTelegramUserId', () => {
  it('accepts positive numbers, bigints, and decimal strings', () => {
    expect(normalizeTelegramUserId(12345)).toBe('12345')
    expect(normalizeTelegramUserId(12345n)).toBe('12345')
    expect(normalizeTelegramUserId('12345')).toBe('12345')
    expect(normalizeTelegramUserId('  12345  ')).toBe('12345')
  })

  it('preserves IDs larger than 2^53 exactly', () => {
    expect(normalizeTelegramUserId('7999999999999999')).toBe('7999999999999999')
    expect(normalizeTelegramUserId(7999999999999999n)).toBe('7999999999999999')
  })

  it('rejects zero, negatives, and non-integers', () => {
    expect(normalizeTelegramUserId(0)).toBeNull()
    expect(normalizeTelegramUserId('0')).toBeNull()
    expect(normalizeTelegramUserId('00')).toBeNull()
    expect(normalizeTelegramUserId(-1)).toBeNull()
    expect(normalizeTelegramUserId(-1n)).toBeNull()
    expect(normalizeTelegramUserId(1.5)).toBeNull()
  })

  it('rejects non-numeric or empty input', () => {
    expect(normalizeTelegramUserId('')).toBeNull()
    expect(normalizeTelegramUserId('abc')).toBeNull()
    expect(normalizeTelegramUserId('12a45')).toBeNull()
    expect(normalizeTelegramUserId(null)).toBeNull()
    expect(normalizeTelegramUserId(undefined)).toBeNull()
  })
})

describe('createPrincipal', () => {
  it('creates typed user and bot principals', () => {
    expect(createUserPrincipal(42)).toEqual({ kind: 'user', telegramUserId: '42' })
    expect(createBotPrincipal(42n)).toEqual({ kind: 'bot', telegramUserId: '42' })
    expect(createPrincipal('user', '42')).toEqual({ kind: 'user', telegramUserId: '42' })
  })

  it('returns null for invalid IDs so callers fail closed', () => {
    expect(createUserPrincipal(0)).toBeNull()
    expect(createBotPrincipal('nope')).toBeNull()
    expect(createUserPrincipal(undefined)).toBeNull()
  })
})

describe('isTelegramPrincipal', () => {
  it('accepts valid principals only', () => {
    expect(isTelegramPrincipal({ kind: 'user', telegramUserId: '42' })).toBe(true)
    expect(isTelegramPrincipal({ kind: 'bot', telegramUserId: '42' })).toBe(true)
  })

  it('rejects malformed values', () => {
    expect(isTelegramPrincipal(null)).toBe(false)
    expect(isTelegramPrincipal({})).toBe(false)
    expect(isTelegramPrincipal({ kind: 'admin', telegramUserId: '42' })).toBe(false)
    expect(isTelegramPrincipal({ kind: 'user', telegramUserId: 42 })).toBe(false)
    expect(isTelegramPrincipal({ kind: 'user', telegramUserId: '0' })).toBe(false)
    expect(isTelegramPrincipal({ kind: 'user', telegramUserId: ' 42 ' })).toBe(false)
  })
})

describe('principalsMatch', () => {
  it('matches identical identities', () => {
    expect(
      principalsMatch({ kind: 'user', telegramUserId: '42' }, { kind: 'user', telegramUserId: '42' }),
    ).toBe(true)
  })

  it('does not match different ids or kinds', () => {
    expect(
      principalsMatch({ kind: 'user', telegramUserId: '42' }, { kind: 'user', telegramUserId: '43' }),
    ).toBe(false)
    expect(
      principalsMatch({ kind: 'user', telegramUserId: '42' }, { kind: 'bot', telegramUserId: '42' }),
    ).toBe(false)
  })

  it('treats missing principals as non-matching (absence is never ownership proof)', () => {
    expect(principalsMatch(null, null)).toBe(false)
    expect(principalsMatch(undefined, { kind: 'user', telegramUserId: '42' })).toBe(false)
    expect(principalsMatch({ kind: 'user', telegramUserId: '42' }, null)).toBe(false)
  })
})

describe('principalKey / parsePrincipalKey', () => {
  it('round-trips through a stable string form', () => {
    const principal = createUserPrincipal(12345)!
    const key = principalKey(principal)
    expect(key).toBe('user:12345')
    expect(parsePrincipalKey(key)).toEqual(principal)
  })

  it('round-trips bot principals', () => {
    expect(parsePrincipalKey('bot:999')).toEqual({ kind: 'bot', telegramUserId: '999' })
  })

  it('rejects malformed keys', () => {
    expect(parsePrincipalKey('')).toBeNull()
    expect(parsePrincipalKey(':42')).toBeNull()
    expect(parsePrincipalKey('user:')).toBeNull()
    expect(parsePrincipalKey('admin:42')).toBeNull()
    expect(parsePrincipalKey('user:0')).toBeNull()
    expect(parsePrincipalKey('user')).toBeNull()
  })
})

describe('accountTypeForPrincipal', () => {
  it('maps principal kind to account type', () => {
    expect(accountTypeForPrincipal({ kind: 'user', telegramUserId: '1' })).toBe('user')
    expect(accountTypeForPrincipal({ kind: 'bot', telegramUserId: '1' })).toBe('bot')
  })
})
