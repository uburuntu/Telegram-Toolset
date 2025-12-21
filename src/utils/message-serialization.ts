/**
 * Utilities for safe message serialization at persistence boundaries.
 *
 * `DeletedMessage._rawMessage` is a runtime-only GramJS object that should NOT be stored
 * in IndexedDB or included in ZIP exports (it's non-serializable / non-portable).
 */

import type { DeletedMessage } from '@/types'

/**
 * Strip the `_rawMessage` field from a message before persisting.
 * Returns a shallow copy without `_rawMessage`.
 */
export function stripRawMessage<T extends DeletedMessage>(message: T): Omit<T, '_rawMessage'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _rawMessage, ...rest } = message
  return rest as Omit<T, '_rawMessage'>
}

/**
 * Strip `_rawMessage` from an array of messages.
 */
export function stripRawMessages<T extends DeletedMessage>(
  messages: T[]
): Omit<T, '_rawMessage'>[] {
  return messages.map(stripRawMessage)
}

/**
 * BigInt-safe JSON.stringify replacement.
 *
 * `bigint` values are converted to strings because standard JSON does not support them.
 * Use this for size estimation or any serialization path that might see `bigint`.
 */
export function safeJsonStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v), space)
}
