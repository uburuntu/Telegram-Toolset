import { Logger, LogLevel } from 'telegram/extensions/Logger'

/**
 * GramJS gates every diagnostic line through {@link Logger.canSend}/`_log`, so a client's
 * `baseLogger` must be a real {@link Logger}. Passing a plain object with only `info`/`warn`/`error`
 * methods crashes connection setup with "this._log.canSend is not a function" the moment GramJS
 * tries to gate a log line (e.g. while sending the login code).
 *
 * This subclass keeps the full logger contract intact and only adds a pre-gate hook so callers can
 * observe every diagnostic line — used to surface flood-wait countdowns — independent of the
 * configured console level.
 */
export class FloodWaitLogger extends Logger {
  private readonly onMessage: (message: string) => void

  constructor(onMessage: (message: string) => void, level: LogLevel = LogLevel.INFO) {
    super(level)
    this.onMessage = onMessage
  }

  _log(level: LogLevel, message: string, color: string): void {
    // Runs before the level gate so flood-wait detection is independent of console verbosity.
    this.onMessage(message)
    super._log(level, message, color)
  }

  log(level: LogLevel, message: string, _color: string): void {
    const line = `[GramJS] ${message}`
    if (level === LogLevel.ERROR) {
      console.error(line)
    } else if (level === LogLevel.WARN) {
      console.warn(line)
    } else if (level === LogLevel.DEBUG) {
      console.debug(line)
    } else {
      console.log(line)
    }
  }
}
