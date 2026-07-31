/**
 * Telegram session coordinator.
 *
 * The single owner of user-session lifecycle transitions. It serializes every activate / deactivate
 * request through one command queue, stamps each with a monotonic generation, and only publishes a
 * typed {@link SessionSnapshot} when the completing command is still the latest request. This makes
 * "last request wins" and "no stale activation after a later deactivation" structural rather than
 * incidental.
 *
 * Before swapping the underlying session it cancels account-affine mutation jobs, but only waits to a
 * bounded deadline: a mutation that never settles cannot block a later activation, and the generation
 * fence prevents its late completion from publishing state. Heavier per-job fencing
 * (abandoned / delivery_uncertain outcomes) belongs to the job runtime.
 *
 * The coordinator is framework-agnostic and backend-injected so it can be unit-tested with deferred
 * promises for every ordering.
 */
import type { ApiCredentials } from '@/types'

export type SessionStatus =
  | 'idle' // no user session desired/active
  | 'active' // user session connected and authorized
  | 'needs_login' // active user account requires (re)authentication
  | 'error' // last transition failed with a typed error

export interface SessionSnapshot {
  status: SessionStatus
  accountId: string | null
  /** Generation of the request that produced this snapshot; strictly increasing. */
  generation: number
  error?: string
}

export interface ActivateRequest {
  accountId: string
  sessionString: string
  credentials: ApiCredentials
}

/**
 * What the caller wants the session to be, recomputed from account state on every change.
 * `hold` means "do not change the session" (e.g. an interactive login owns it, or credentials are
 * missing) — mutation cancellation still runs so a swap-in-progress is quiesced.
 */
export type DesiredSession =
  | { kind: 'hold' }
  | { kind: 'teardown' }
  | { kind: 'activate'; request: ActivateRequest }

/** Low-level session operations. Wraps the mtcute singleton in production; faked in tests. */
export interface SessionBackend {
  /**
   * Install a synchronous barrier so gateway calls block until the in-flight transition completes.
   * Returns a token passed back to {@link completeTransition}.
   */
  beginTransition(): number
  completeTransition(token: number): void
  /** Cancel account-affine mutation jobs before a swap; resolves once they have settled. */
  cancelPendingMutations(): Promise<void>
  /** Bring `request`'s user session online. Resolves `true` when authorized, `false` if not. */
  activateUserSession(request: ActivateRequest): Promise<boolean>
  /** Tear down any active user session. Best-effort; must not throw for expected cleanup failures. */
  teardownUserSession(): Promise<void>
}

export interface SessionCoordinatorOptions {
  backend: SessionBackend
  /** How long to wait for mutation cancellation before proceeding with a swap. */
  cancellationDeadlineMs?: number
  /** Injectable deadline scheduler (defaults to setTimeout) so tests can fire it deterministically. */
  scheduleDeadline?: (onDeadline: () => void, ms: number) => unknown
  cancelDeadline?: (handle: unknown) => void
}

const DEFAULT_CANCELLATION_DEADLINE_MS = 8000

export type CancellationOutcome = 'settled' | 'timed_out'

export class TelegramSessionCoordinator {
  private readonly backend: SessionBackend
  private readonly cancellationDeadlineMs: number
  private readonly scheduleDeadline: (onDeadline: () => void, ms: number) => unknown
  private readonly cancelDeadline: (handle: unknown) => void

  private queue: Promise<void> = Promise.resolve()
  private generation = 0
  private disposed = false
  private snapshot: SessionSnapshot = { status: 'idle', accountId: null, generation: 0 }
  private readonly listeners = new Set<(snapshot: SessionSnapshot) => void>()

  constructor(options: SessionCoordinatorOptions) {
    this.backend = options.backend
    this.cancellationDeadlineMs = options.cancellationDeadlineMs ?? DEFAULT_CANCELLATION_DEADLINE_MS
    this.scheduleDeadline =
      options.scheduleDeadline ?? ((onDeadline, ms) => setTimeout(onDeadline, ms))
    this.cancelDeadline =
      options.cancelDeadline ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot
  }

  /** Subscribe to snapshot changes. Returns an unsubscribe function. */
  subscribe(listener: (snapshot: SessionSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Request a session state. The synchronous part (generation bump + transition barrier) runs
   * immediately so a later request always supersedes an earlier one, even before the queue drains.
   */
  requestSync(desired: DesiredSession): number {
    if (this.disposed) {
      return this.generation
    }

    const generation = ++this.generation
    const token = this.backend.beginTransition()
    this.queue = this.queue.then(
      () => this.run(desired, generation, token),
      () => this.run(desired, generation, token),
    )
    return generation
  }

  /** Convenience wrappers mirroring the coordinator command vocabulary. */
  activate(request: ActivateRequest): number {
    return this.requestSync({ kind: 'activate', request })
  }

  deactivate(): number {
    return this.requestSync({ kind: 'teardown' })
  }

  hold(): number {
    return this.requestSync({ kind: 'hold' })
  }

  /** Stop publishing state. In-flight commands still settle but can no longer mutate the snapshot. */
  dispose(): void {
    this.disposed = true
    this.generation++
    this.listeners.clear()
  }

  private async run(desired: DesiredSession, generation: number, token: number): Promise<void> {
    try {
      if (this.isSuperseded(generation)) {
        return
      }

      // Quiesce account-affine mutations before touching the session, but never let an unsettled
      // job block the swap past the deadline.
      await this.cancelWithDeadline()
      if (this.isSuperseded(generation)) {
        return
      }

      switch (desired.kind) {
        case 'hold':
          return
        case 'teardown': {
          await this.backend.teardownUserSession()
          this.publish({ status: 'idle', accountId: null }, generation)
          return
        }
        case 'activate': {
          const authorized = await this.backend.activateUserSession(desired.request)
          this.publish(
            authorized
              ? { status: 'active', accountId: desired.request.accountId }
              : { status: 'needs_login', accountId: desired.request.accountId },
            generation,
          )
          return
        }
      }
    } catch (error) {
      const accountId = desired.kind === 'activate' ? desired.request.accountId : null
      this.publish(
        {
          status: 'error',
          accountId,
          error: error instanceof Error ? error.message : String(error),
        },
        generation,
      )
    } finally {
      this.backend.completeTransition(token)
    }
  }

  private cancelWithDeadline(): Promise<CancellationOutcome> {
    return new Promise<CancellationOutcome>((resolve) => {
      let finished = false
      const finish = (outcome: CancellationOutcome) => {
        if (!finished) {
          finished = true
          resolve(outcome)
        }
      }

      const handle = this.scheduleDeadline(() => finish('timed_out'), this.cancellationDeadlineMs)
      void this.backend
        .cancelPendingMutations()
        .catch(() => {
          // Cancellation failures are non-fatal; we still proceed with the swap.
        })
        .then(() => {
          this.cancelDeadline(handle)
          finish('settled')
        })
    })
  }

  private isSuperseded(generation: number): boolean {
    return this.disposed || generation !== this.generation
  }

  private publish(partial: Omit<SessionSnapshot, 'generation'>, generation: number): void {
    // A stale or superseded command must never publish; this is the core race guarantee.
    if (this.isSuperseded(generation)) {
      return
    }

    this.snapshot = { ...partial, generation }
    for (const listener of this.listeners) {
      listener(this.snapshot)
    }
  }
}
