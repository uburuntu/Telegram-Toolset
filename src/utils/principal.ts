/**
 * Pure helpers for the stable Telegram identity model (`TelegramPrincipal`).
 *
 * These functions never touch the network, storage, or the GramJS client. They exist so that the
 * account store, auth flow, and storage repositories share one canonical, testable definition of
 * "is this the same Telegram identity?".
 */
import type { AccountType } from '@/types/account'
import type { TelegramPrincipal, TelegramPrincipalKind } from '@/types/principal'

/**
 * Normalize a Telegram user ID into a canonical decimal string.
 *
 * Telegram user IDs are positive integers that can exceed 32 bits, so we keep them as strings and
 * accept `string | number | bigint` at the boundary. Returns `null` for anything that is not a
 * positive integer, so callers can fail closed instead of persisting a bogus identity.
 */
export function normalizeTelegramUserId(
  raw: string | number | bigint | null | undefined,
): string | null {
  if (raw === null || raw === undefined) {
    return null
  }

  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw <= 0) {
      return null
    }
    return String(raw)
  }

  if (typeof raw === 'bigint') {
    return raw > 0n ? raw.toString() : null
  }

  const trimmed = raw.trim()
  if (!/^[0-9]+$/.test(trimmed)) {
    return null
  }

  // Reject "0" and any zero-padded zero while preserving large values exactly.
  try {
    return BigInt(trimmed) > 0n ? BigInt(trimmed).toString() : null
  } catch {
    return null
  }
}

export function createPrincipal(
  kind: TelegramPrincipalKind,
  telegramUserId: string | number | bigint | null | undefined,
): TelegramPrincipal | null {
  const normalized = normalizeTelegramUserId(telegramUserId)
  if (!normalized) {
    return null
  }

  return { kind, telegramUserId: normalized }
}

export function createUserPrincipal(
  telegramUserId: string | number | bigint | null | undefined,
): TelegramPrincipal | null {
  return createPrincipal('user', telegramUserId)
}

export function createBotPrincipal(
  telegramUserId: string | number | bigint | null | undefined,
): TelegramPrincipal | null {
  return createPrincipal('bot', telegramUserId)
}

export function isTelegramPrincipal(value: unknown): value is TelegramPrincipal {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as { kind?: unknown; telegramUserId?: unknown }
  if (candidate.kind !== 'user' && candidate.kind !== 'bot') {
    return false
  }

  return (
    typeof candidate.telegramUserId === 'string' &&
    normalizeTelegramUserId(candidate.telegramUserId) === candidate.telegramUserId
  )
}

/**
 * Two principals match when they refer to the same Telegram identity (kind + user ID).
 * `null`/`undefined` never match, so absence of a principal is never treated as ownership proof.
 */
export function principalsMatch(
  a: TelegramPrincipal | null | undefined,
  b: TelegramPrincipal | null | undefined,
): boolean {
  if (!a || !b) {
    return false
  }

  return a.kind === b.kind && a.telegramUserId === b.telegramUserId
}

/** Stable, comparable string form of a principal, e.g. `user:12345`. */
export function principalKey(principal: TelegramPrincipal): string {
  return `${principal.kind}:${principal.telegramUserId}`
}

export function parsePrincipalKey(key: string | null | undefined): TelegramPrincipal | null {
  if (!key) {
    return null
  }

  const separator = key.indexOf(':')
  if (separator <= 0) {
    return null
  }

  const kind = key.slice(0, separator)
  if (kind !== 'user' && kind !== 'bot') {
    return null
  }

  return createPrincipal(kind, key.slice(separator + 1))
}

/** The account type that owns a given principal kind. */
export function accountTypeForPrincipal(principal: TelegramPrincipal): AccountType {
  return principal.kind === 'bot' ? 'bot' : 'user'
}
