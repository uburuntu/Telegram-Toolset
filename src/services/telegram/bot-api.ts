/**
 * Telegram Bot HTTP API wrapper
 *
 * Uses the simple HTTP API (not MTProto) for bot operations.
 * This is simpler and doesn't require GramJS for basic bot operations.
 */

import { withRetry } from './rate-limiter'

const BOT_API_URL = 'https://api.telegram.org/bot'

export interface BotApiUser {
  id: number
  is_bot: boolean
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
  added_to_attachment_menu?: boolean
  can_join_groups?: boolean
  can_read_all_group_messages?: boolean
  supports_inline_queries?: boolean
  can_connect_to_business?: boolean
  has_main_web_app?: boolean
}

interface BotApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: {
    retry_after?: number
  }
}

type BotApiError = Error & {
  status?: number
  parameters?: BotApiResponse<unknown>['parameters']
}

function shouldRetryBotApiRequest(error: Error): boolean {
  const status = (error as BotApiError).status
  return status === undefined || status === 429 || status >= 500
}

/**
 * Validate a bot token and get bot information
 */
export async function getBotInfo(token: string): Promise<BotApiUser> {
  return withRetry(
    async () => {
      const response = await fetch(`${BOT_API_URL}${token}/getMe`)
      const data: BotApiResponse<BotApiUser> = await response.json()

      if (!response.ok || !data.ok || !data.result) {
        const error = new Error(data.description || 'Failed to validate bot token') as BotApiError
        error.status = data.error_code || response.status
        error.parameters = data.parameters
        throw error
      }

      return data.result
    },
    { shouldRetry: shouldRetryBotApiRequest },
  )
}

/**
 * Check if a string looks like a valid bot token format
 */
export function isValidTokenFormat(token: string): boolean {
  // Typical format: 123456789:ABCdefGHIjklMNOpqrSTUvwxYZ-_
  // Length may vary; accept 20+ chars for the secret part to avoid false negatives.
  return /^\d+:[A-Za-z0-9_-]{20,}$/.test(token)
}

/**
 * Mask a bot token for display (hide the secret part)
 */
export function maskBotToken(token: string): string {
  if (!token.includes(':')) return token

  const [id, secret] = token.split(':')
  if (!secret || secret.length < 10) return token

  const visibleStart = secret.slice(0, 3)
  const visibleEnd = secret.slice(-2)
  return `${id}:${visibleStart}${'•'.repeat(8)}${visibleEnd}`
}
