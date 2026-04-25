/**
 * User-friendly error message translations
 *
 * Maps technical errors to human-readable messages for better UX.
 */

import { i18n } from '@/i18n'

interface ErrorMapping {
  pattern: RegExp | string
  translationKey: ErrorTranslationKey
}

type ErrorTranslationKey =
  | 'invalidPhoneNumber'
  | 'invalidCode'
  | 'codeExpired'
  | 'invalidPassword'
  | 'twoFactorRequired'
  | 'rateLimited'
  | 'slowModeActive'
  | 'adminRequired'
  | 'cannotSend'
  | 'banned'
  | 'privateChannel'
  | 'connectionError'
  | 'timeout'
  | 'sessionExpired'
  | 'sessionRevoked'
  | 'loginRequired'
  | 'invalidBotToken'
  | 'fileExpired'
  | 'mediaNotFound'
  | 'cancelled'

const ERROR_MAPPINGS: ErrorMapping[] = [
  // Auth errors
  {
    pattern: /PHONE_NUMBER_INVALID/i,
    translationKey: 'invalidPhoneNumber',
  },
  {
    pattern: /PHONE_CODE_INVALID/i,
    translationKey: 'invalidCode',
  },
  {
    pattern: /PHONE_CODE_EXPIRED/i,
    translationKey: 'codeExpired',
  },
  {
    pattern: /PASSWORD_HASH_INVALID/i,
    translationKey: 'invalidPassword',
  },
  {
    pattern: /SESSION_PASSWORD_NEEDED/i,
    translationKey: 'twoFactorRequired',
  },

  // Rate limiting
  {
    pattern: /FLOOD_WAIT_(\d+)/i,
    translationKey: 'rateLimited',
  },
  {
    pattern: /SLOWMODE_WAIT_(\d+)/i,
    translationKey: 'slowModeActive',
  },

  // Permission errors
  {
    pattern: /CHAT_ADMIN_REQUIRED/i,
    translationKey: 'adminRequired',
  },
  {
    pattern: /CHAT_WRITE_FORBIDDEN/i,
    translationKey: 'cannotSend',
  },
  {
    pattern: /USER_BANNED_IN_CHANNEL/i,
    translationKey: 'banned',
  },
  {
    pattern: /CHANNEL_PRIVATE/i,
    translationKey: 'privateChannel',
  },

  // Network errors
  {
    pattern: /NETWORK_ERROR|NetworkError|net::ERR_/i,
    translationKey: 'connectionError',
  },
  {
    pattern: /TIMEOUT|TimeoutError/i,
    translationKey: 'timeout',
  },

  // Session errors
  {
    pattern: /AUTH_KEY_UNREGISTERED/i,
    translationKey: 'sessionExpired',
  },
  {
    pattern: /SESSION_REVOKED/i,
    translationKey: 'sessionRevoked',
  },
  {
    pattern: /Saved session could not be restored/i,
    translationKey: 'loginRequired',
  },

  // Bot errors
  {
    pattern: /BOT_TOKEN_INVALID/i,
    translationKey: 'invalidBotToken',
  },

  // Media errors
  {
    pattern: /FILE_REFERENCE_EXPIRED/i,
    translationKey: 'fileExpired',
  },
  {
    pattern: /MEDIA_EMPTY/i,
    translationKey: 'mediaNotFound',
  },

  // Generic fallbacks
  {
    pattern: /aborted|cancelled/i,
    translationKey: 'cancelled',
  },
]

export interface UserFriendlyError {
  title: string
  message: string
  isRetryable: boolean
  originalError: string
}

/**
 * Convert a technical error to a user-friendly message
 */
export function toUserFriendlyError(error: unknown): UserFriendlyError {
  const errorMessage = error instanceof Error ? error.message : String(error)
  const errorString = errorMessage.toLowerCase()

  // Check for known error patterns
  for (const mapping of ERROR_MAPPINGS) {
    const pattern =
      typeof mapping.pattern === 'string' ? new RegExp(mapping.pattern, 'i') : mapping.pattern

    if (pattern.test(errorMessage)) {
      const translated = getTranslatedError(mapping.translationKey, errorMessage)

      return {
        title: translated.title,
        message: translated.message,
        isRetryable: isRetryableError(errorMessage),
        originalError: errorMessage,
      }
    }
  }

  // Generic fallback
  return {
    title: i18n.global.t('common.error'),
    message: i18n.global.t('errors.unexpected.message'),
    isRetryable: !errorString.includes('invalid') && !errorString.includes('forbidden'),
    originalError: errorMessage,
  }
}

function getTranslatedError(
  translationKey: ErrorTranslationKey,
  originalError: string,
): Pick<UserFriendlyError, 'title' | 'message'> {
  const titleKey = `errors.${translationKey}.title`
  let messageKey = `errors.${translationKey}.message`
  let params: Record<string, string> | undefined

  if (translationKey === 'rateLimited') {
    const floodMatch = originalError.match(/FLOOD_WAIT_(\d+)/i)
    if (floodMatch?.[1]) {
      messageKey = 'errors.rateLimited.messageWithDuration'
      params = {
        duration: formatWaitTime(parseInt(floodMatch[1], 10)),
      }
    }
  }

  return {
    title: i18n.global.te(titleKey) ? i18n.global.t(titleKey) : i18n.global.t('common.error'),
    message: i18n.global.te(messageKey)
      ? params
        ? i18n.global.t(messageKey, params)
        : i18n.global.t(messageKey)
      : i18n.global.t('errors.unexpected.message'),
  }
}

/**
 * Check if an error is likely retryable
 */
function isRetryableError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase()

  // Not retryable: auth failures, permission issues
  if (
    lower.includes('invalid') ||
    lower.includes('forbidden') ||
    lower.includes('banned') ||
    lower.includes('revoked') ||
    (lower.includes('expired') && !lower.includes('flood'))
  ) {
    return false
  }

  // Retryable: rate limits, network issues, timeouts
  if (
    lower.includes('flood') ||
    lower.includes('timeout') ||
    lower.includes('network') ||
    lower.includes('connection')
  ) {
    return true
  }

  // Default to retryable for unknown errors
  return true
}

/**
 * Format wait time for rate limit messages
 */
function formatWaitTime(seconds: number): string {
  if (seconds < 60) {
    return formatWaitUnit('seconds', seconds)
  }

  if (seconds < 3600) {
    return formatWaitUnit('minutes', Math.ceil(seconds / 60))
  }

  return formatWaitUnit('hours', Math.ceil(seconds / 3600))
}

function formatWaitUnit(unit: 'seconds' | 'minutes' | 'hours', count: number): string {
  const locale = i18n.global.locale.value
  const number = new Intl.NumberFormat(locale).format(count)
  const pluralCategory = new Intl.PluralRules(locale).select(count)
  const exactKey = `errors.waitTime.${unit}.${pluralCategory}`
  const fallbackKey = `errors.waitTime.${unit}.other`

  return i18n.global.t(i18n.global.te(exactKey) ? exactKey : fallbackKey, { count: number })
}

/**
 * Show a user-friendly error toast
 */
export function showErrorToast(
  showToast: (type: 'error', message: string) => void,
  error: unknown,
): void {
  const friendly = toUserFriendlyError(error)
  showToast('error', friendly.message)
}
