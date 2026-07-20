/**
 * Stable Telegram identity.
 *
 * A `TelegramPrincipal` is the immutable authority for account-owned data. Unlike the
 * installation-scoped `SavedAccount.id` (a random local UUID), the principal is derived from
 * Telegram's own user ID and therefore survives re-login, phone-number changes, and local
 * metadata loss.
 */
export type TelegramPrincipal =
  | { kind: 'user'; telegramUserId: string }
  | { kind: 'bot'; telegramUserId: string }

export type TelegramPrincipalKind = TelegramPrincipal['kind']
