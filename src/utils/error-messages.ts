/**
 * User-friendly error message translations
 *
 * Maps technical errors to human-readable messages for better UX.
 */

interface ErrorMapping {
  pattern: RegExp | string
  message: string
  title?: string
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  // Auth errors
  {
    pattern: /PHONE_NUMBER_INVALID/i,
    message: 'The phone number entered is invalid. Please check and try again.',
    title: 'Invalid Phone Number',
  },
  {
    pattern: /PHONE_CODE_INVALID/i,
    message: 'The verification code is incorrect. Please check and try again.',
    title: 'Invalid Code',
  },
  {
    pattern: /PHONE_CODE_EXPIRED/i,
    message: 'The verification code has expired. Please request a new one.',
    title: 'Code Expired',
  },
  {
    pattern: /PASSWORD_HASH_INVALID/i,
    message: 'The password is incorrect. Please try again.',
    title: 'Invalid Password',
  },
  {
    pattern: /SESSION_PASSWORD_NEEDED/i,
    message: 'Two-factor authentication is enabled. Please enter your password.',
    title: '2FA Required',
  },

  // Rate limiting
  {
    pattern: /FLOOD_WAIT_(\d+)/i,
    message: 'Too many requests. Please wait a moment and try again.',
    title: 'Rate Limited',
  },
  {
    pattern: /SLOWMODE_WAIT_(\d+)/i,
    message: 'Slow mode is enabled. Please wait before sending another message.',
    title: 'Slow Mode Active',
  },

  // Permission errors
  {
    pattern: /CHAT_ADMIN_REQUIRED/i,
    message: 'You need admin rights to perform this action.',
    title: 'Admin Required',
  },
  {
    pattern: /CHAT_WRITE_FORBIDDEN/i,
    message: "You don't have permission to send messages in this chat.",
    title: 'Cannot Send',
  },
  {
    pattern: /USER_BANNED_IN_CHANNEL/i,
    message: 'You are banned from this channel.',
    title: 'Banned',
  },
  {
    pattern: /CHANNEL_PRIVATE/i,
    message: 'This channel is private. You need an invitation to join.',
    title: 'Private Channel',
  },

  // Network errors
  {
    pattern: /NETWORK_ERROR|NetworkError|net::ERR_/i,
    message: 'Network connection failed. Please check your internet and try again.',
    title: 'Connection Error',
  },
  {
    pattern: /TIMEOUT|TimeoutError/i,
    message: 'The request timed out. Please try again.',
    title: 'Timeout',
  },

  // Session errors
  {
    pattern: /AUTH_KEY_UNREGISTERED/i,
    message: 'Your session has expired. Please log in again.',
    title: 'Session Expired',
  },
  {
    pattern: /SESSION_REVOKED/i,
    message: 'Your session was revoked. Please log in again.',
    title: 'Session Revoked',
  },

  // Bot errors
  {
    pattern: /BOT_TOKEN_INVALID/i,
    message: 'The bot token is invalid. Please check and try again.',
    title: 'Invalid Bot Token',
  },

  // Media errors
  {
    pattern: /FILE_REFERENCE_EXPIRED/i,
    message: 'The file reference has expired. Please refresh and try again.',
    title: 'File Expired',
  },
  {
    pattern: /MEDIA_EMPTY/i,
    message: 'The media file could not be found or has been deleted.',
    title: 'Media Not Found',
  },

  // Generic fallbacks
  {
    pattern: /aborted|cancelled/i,
    message: 'The operation was cancelled.',
    title: 'Cancelled',
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
      // Extract wait time for rate limit errors
      let message = mapping.message
      const floodMatch = errorMessage.match(/FLOOD_WAIT_(\d+)/i)
      if (floodMatch && floodMatch[1]) {
        const seconds = parseInt(floodMatch[1], 10)
        message = `Too many requests. Please wait ${formatWaitTime(seconds)} and try again.`
      }

      return {
        title: mapping.title || 'Error',
        message,
        isRetryable: isRetryableError(errorMessage),
        originalError: errorMessage,
      }
    }
  }

  // Generic fallback
  return {
    title: 'Error',
    message: 'An unexpected error occurred. Please try again.',
    isRetryable: !errorString.includes('invalid') && !errorString.includes('forbidden'),
    originalError: errorMessage,
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
    return `${seconds} seconds`
  } else if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60)
    return `${minutes} minute${minutes > 1 ? 's' : ''}`
  } else {
    const hours = Math.ceil(seconds / 3600)
    return `${hours} hour${hours > 1 ? 's' : ''}`
  }
}

/**
 * Show a user-friendly error toast
 */
export function showErrorToast(
  showToast: (type: 'error', message: string) => void,
  error: unknown
): void {
  const friendly = toUserFriendlyError(error)
  showToast('error', friendly.message)
}
