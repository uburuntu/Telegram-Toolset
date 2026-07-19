/**
 * Cross-tab invalidation channel (ARCHITECTURE.md §6).
 *
 * Same-origin tabs each hold their own in-memory copy of account and ownership state. The
 * per-account epoch in localStorage already fences *late writes* across tabs, but a tab's
 * *displayed* state (account list, active selection, credentials, corrupt flags) stays stale until
 * it re-reads storage. This channel lets a tab that commits a mutation notify its peers to reload,
 * so no tab keeps operating on accounts another tab has already changed or removed.
 *
 * BroadcastChannel is unavailable in some environments (older browsers, jsdom-based tests). Callers
 * transparently get a no-op channel there and simply fall back to reload-on-next-read.
 */

export interface CrossTabChannel {
  /** Notify peer tabs that persisted account/ownership state changed. Never throws. */
  post(): void
  /** Release the underlying channel. Never throws. */
  close(): void
}

const NOOP_CHANNEL: CrossTabChannel = {
  post() {},
  close() {},
}

interface InvalidationMessage {
  type: 'invalidate'
  origin: string
}

function isInvalidationMessage(value: unknown): value is InvalidationMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'invalidate' &&
    typeof (value as { origin?: unknown }).origin === 'string'
  )
}

/**
 * Create a channel that invokes `onInvalidated` when a *different* tab posts an invalidation. The
 * posting instance never receives its own message, so a tab does not reload in response to its own
 * mutation.
 */
export function createInvalidationChannel(
  name: string,
  onInvalidated: () => void,
): CrossTabChannel {
  const Ctor = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel
  if (typeof Ctor !== 'function') {
    return NOOP_CHANNEL
  }

  // Unique per instance so we ignore our own echoes. BroadcastChannel does not deliver a message
  // back to the posting instance, but a single context could hold more than one instance.
  const origin = `${Date.now()}-${Math.random().toString(36).slice(2)}`

  let channel: BroadcastChannel
  try {
    channel = new Ctor(name)
  } catch {
    return NOOP_CHANNEL
  }

  channel.onmessage = (event: MessageEvent) => {
    if (!isInvalidationMessage(event.data) || event.data.origin === origin) {
      return
    }
    onInvalidated()
  }

  return {
    post() {
      try {
        channel.postMessage({ type: 'invalidate', origin } satisfies InvalidationMessage)
      } catch {
        // A closed/errored channel must never break the mutation that triggered the broadcast.
      }
    },
    close() {
      try {
        channel.close()
      } catch {
        // Best effort; a failed close must not surface to callers.
      }
    },
  }
}
