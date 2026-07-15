import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type ActivateRequest,
  type SessionBackend,
  type SessionSnapshot,
  TelegramSessionCoordinator,
} from '@/services/telegram/session-coordinator'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const credentials = { apiId: 111, apiHash: 'hash' }
const reqA: ActivateRequest = { accountId: 'a', sessionString: 'sa', credentials }
const reqB: ActivateRequest = { accountId: 'b', sessionString: 'sb', credentials }

/**
 * Deferred-driven fake backend. Every async operation can be resolved immediately (auto mode) or
 * held pending so tests can drive precise orderings.
 */
class FakeBackend implements SessionBackend {
  log: string[] = []
  completedTokens: number[] = []
  cancelPending: Deferred<void>[] = []
  activatePending: Array<{ request: ActivateRequest; deferred: Deferred<boolean> }> = []
  teardownPending: Deferred<void>[] = []

  autoResolveCancel = true
  /** null => hold the activation pending; otherwise resolve immediately with the boolean. */
  autoResolveActivate: boolean | null = true
  autoResolveTeardown = true
  activateShouldThrow = false

  private token = 0

  beginTransition(): number {
    const token = ++this.token
    this.log.push(`begin:${token}`)
    return token
  }

  completeTransition(token: number): void {
    this.completedTokens.push(token)
    this.log.push(`complete:${token}`)
  }

  cancelPendingMutations(): Promise<void> {
    this.log.push('cancel')
    const d = deferred<void>()
    this.cancelPending.push(d)
    if (this.autoResolveCancel) {
      d.resolve()
    }
    return d.promise
  }

  activateUserSession(request: ActivateRequest): Promise<boolean> {
    this.log.push(`activate:${request.accountId}`)
    if (this.activateShouldThrow) {
      return Promise.reject(new Error('activation boom'))
    }
    const d = deferred<boolean>()
    this.activatePending.push({ request, deferred: d })
    if (this.autoResolveActivate !== null) {
      d.resolve(this.autoResolveActivate)
    }
    return d.promise
  }

  teardownUserSession(): Promise<void> {
    this.log.push('teardown')
    const d = deferred<void>()
    this.teardownPending.push(d)
    if (this.autoResolveTeardown) {
      d.resolve()
    }
    return d.promise
  }
}

describe('TelegramSessionCoordinator', () => {
  let backend: FakeBackend
  let coordinator: TelegramSessionCoordinator
  let deadlineCallback: (() => void) | null
  let deadlineCancelled: boolean
  let snapshots: SessionSnapshot[]

  function fireDeadline(): void {
    deadlineCallback?.()
  }

  beforeEach(() => {
    backend = new FakeBackend()
    deadlineCallback = null
    deadlineCancelled = false
    coordinator = new TelegramSessionCoordinator({
      backend,
      cancellationDeadlineMs: 1000,
      scheduleDeadline: (onDeadline) => {
        deadlineCallback = onDeadline
        return 'handle'
      },
      cancelDeadline: () => {
        deadlineCancelled = true
      },
    })
    snapshots = []
    coordinator.subscribe((snapshot) => snapshots.push(snapshot))
  })

  it('activates and publishes an active snapshot with a monotonic generation', async () => {
    const generation = coordinator.activate(reqA)
    await flushPromises()

    expect(coordinator.getSnapshot()).toEqual({
      status: 'active',
      accountId: 'a',
      generation,
    })
    expect(backend.log).toEqual(['begin:1', 'cancel', 'activate:a', 'complete:1'])
    expect(deadlineCancelled).toBe(true)
  })

  it('publishes needs_login when activation reports unauthorized', async () => {
    backend.autoResolveActivate = false
    coordinator.activate(reqA)
    await flushPromises()

    expect(coordinator.getSnapshot().status).toBe('needs_login')
    expect(coordinator.getSnapshot().accountId).toBe('a')
  })

  it('publishes an idle snapshot on teardown', async () => {
    coordinator.activate(reqA)
    await flushPromises()
    coordinator.deactivate()
    await flushPromises()

    expect(coordinator.getSnapshot().status).toBe('idle')
    expect(coordinator.getSnapshot().accountId).toBeNull()
    expect(backend.log).toContain('teardown')
  })

  it('holds without changing the snapshot but still cancels mutations and closes the barrier', async () => {
    coordinator.activate(reqA)
    await flushPromises()
    const afterActivate = coordinator.getSnapshot()

    coordinator.hold()
    await flushPromises()

    expect(coordinator.getSnapshot()).toEqual(afterActivate)
    // Second command still ran a cancel and paired begin/complete on the transition barrier.
    expect(backend.completedTokens).toEqual([1, 2])
    expect(backend.log.filter((entry) => entry === 'cancel')).toHaveLength(2)
  })

  it('serializes rapid activate A -> B and only the last request publishes', async () => {
    backend.autoResolveActivate = null // hold activations pending

    coordinator.activate(reqA)
    await flushPromises()
    expect(backend.log).toContain('activate:a')

    coordinator.activate(reqB)
    await flushPromises()
    // B is queued behind the still-pending A activation.
    expect(backend.log).not.toContain('activate:b')

    // Resolve the stale A activation: it must NOT publish because B superseded it.
    backend.activatePending[0].deferred.resolve(true)
    await flushPromises()
    expect(snapshots.some((s) => s.accountId === 'a')).toBe(false)

    backend.activatePending[1].deferred.resolve(true)
    await flushPromises()

    expect(coordinator.getSnapshot()).toMatchObject({ status: 'active', accountId: 'b' })
    expect(snapshots.filter((s) => s.status === 'active')).toHaveLength(1)
  })

  it('does not let a stale activation reconnect after a later deactivation', async () => {
    backend.autoResolveActivate = null

    coordinator.activate(reqA)
    await flushPromises()

    coordinator.deactivate()
    // Stale A activation resolves late.
    backend.activatePending[0].deferred.resolve(true)
    await flushPromises()

    expect(coordinator.getSnapshot().status).toBe('idle')
    expect(snapshots.some((s) => s.status === 'active')).toBe(false)
  })

  it('never-settling mutation cancellation cannot block a later activation past the deadline', async () => {
    backend.autoResolveCancel = false // cancellation hangs forever

    coordinator.activate(reqA)
    await flushPromises()
    // Blocked in cancellation: activation has not started.
    expect(backend.log).not.toContain('activate:a')

    fireDeadline()
    await flushPromises()

    expect(backend.log).toContain('activate:a')
    expect(coordinator.getSnapshot()).toMatchObject({ status: 'active', accountId: 'a' })
  })

  it('a late cancellation completion after the deadline cannot publish or start work', async () => {
    backend.autoResolveCancel = false
    backend.autoResolveActivate = null

    coordinator.activate(reqA)
    await flushPromises()
    fireDeadline()
    await flushPromises()

    // Supersede the in-flight activation before it settles.
    coordinator.deactivate()
    backend.activatePending[0].deferred.resolve(true) // stale A completion
    // The original (never-settling) cancellation finally resolves, long after its deadline.
    backend.cancelPending[0].resolve()
    await flushPromises()

    expect(coordinator.getSnapshot().status).toBe('idle')
    expect(snapshots.some((s) => s.accountId === 'a')).toBe(false)
  })

  it('skips a stale activation entirely when superseded during the cancellation wait', async () => {
    backend.autoResolveCancel = false

    coordinator.activate(reqA)
    await flushPromises()
    // A is parked in the cancellation wait; supersede it before the deadline.
    coordinator.activate(reqB)

    fireDeadline() // releases A's cancellation wait
    await flushPromises()
    // A was superseded, so it must never touch the session.
    expect(backend.log).not.toContain('activate:a')

    fireDeadline() // releases B's cancellation wait
    await flushPromises()

    expect(backend.log).toContain('activate:b')
    expect(coordinator.getSnapshot()).toMatchObject({ status: 'active', accountId: 'b' })
  })

  it('reaches the final requested state across rapid A -> B -> teardown -> A', async () => {
    coordinator.activate(reqA)
    coordinator.activate(reqB)
    coordinator.deactivate()
    coordinator.activate(reqA)
    await flushPromises()

    expect(coordinator.getSnapshot()).toMatchObject({ status: 'active', accountId: 'a' })
  })

  it('publishes a typed error snapshot and still closes the barrier when activation throws', async () => {
    backend.activateShouldThrow = true
    coordinator.activate(reqA)
    await flushPromises()

    expect(coordinator.getSnapshot()).toMatchObject({
      status: 'error',
      accountId: 'a',
      error: 'activation boom',
    })
    expect(backend.completedTokens).toEqual([1])
  })

  it('stops publishing after dispose', async () => {
    coordinator.activate(reqA)
    await flushPromises()
    const generationBefore = coordinator.getSnapshot().generation

    coordinator.dispose()
    coordinator.activate(reqB)
    await flushPromises()

    expect(coordinator.getSnapshot().generation).toBe(generationBefore)
    expect(coordinator.getSnapshot().accountId).toBe('a')
  })
})
