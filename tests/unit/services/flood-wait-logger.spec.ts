import { Logger, LogLevel } from 'telegram/extensions/Logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FloodWaitLogger } from '@/services/telegram/flood-wait-logger'

describe('FloodWaitLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('is a real GramJS Logger with the full gating contract', () => {
    // Regression guard: GramJS calls `this._log.canSend(...)` while connecting/sending the login
    // code. A plain object without `canSend` crashed with "this._log.canSend is not a function".
    const logger = new FloodWaitLogger(() => {})

    expect(logger).toBeInstanceOf(Logger)
    expect(typeof logger.canSend).toBe('function')
    expect(logger.canSend(LogLevel.ERROR)).toBe(true)
    expect(logger.canSend(LogLevel.INFO)).toBe(true)
    // Default level is INFO, so DEBUG is gated out.
    expect(logger.canSend(LogLevel.DEBUG)).toBe(false)
  })

  it('parses flood-wait notices and reports seconds + method to the callback', () => {
    const onFloodWait = vi.fn()
    const logger = new FloodWaitLogger(onFloodWait)

    logger.info('Sleeping for 30s on flood wait (Caused by auth.SendCode)')

    expect(onFloodWait).toHaveBeenCalledWith(
      'Sleeping for 30s on flood wait (Caused by auth.SendCode)',
    )
  })

  it('observes messages before the level gate suppresses them', () => {
    // A debug line is gated out of console output at the default INFO level, but the pre-gate hook
    // must still see it so flood-wait detection never depends on console verbosity.
    const seen = vi.fn()
    const logger = new FloodWaitLogger(seen)

    logger.debug('Sleeping for 5s on flood wait (Caused by messages.SendMessage)')

    expect(seen).toHaveBeenCalledWith(
      'Sleeping for 5s on flood wait (Caused by messages.SendMessage)',
    )
    // Gated out: no console output for a debug line at INFO level.
    expect(console.debug).not.toHaveBeenCalled()
  })

  it('routes emitted lines to the matching console channel with a stable prefix', () => {
    const logger = new FloodWaitLogger(() => {})

    logger.error('boom')
    logger.warn('careful')
    logger.info('fyi')

    expect(console.error).toHaveBeenCalledWith('[GramJS] boom')
    expect(console.warn).toHaveBeenCalledWith('[GramJS] careful')
    expect(console.log).toHaveBeenCalledWith('[GramJS] fyi')
  })
})
