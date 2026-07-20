/**
 * Job context factory and fencing helpers.
 *
 * These are pure aside from creating an `AbortController`. The factory captures ownership and the
 * session/account generations at creation time; the guards let callbacks and persistence commits
 * verify that a job still speaks for the account and session it started under, so a later account
 * switch, removal, or session swap cannot misattribute data.
 */
import { v4 as uuidv4 } from 'uuid'
import type { JobContext, TelegramPrincipal } from '@/types'

export interface CreateJobContextParams {
  accountId: string
  principal: TelegramPrincipal
  sessionGeneration: number
  accountEpoch: number
  /** Optional parent signal (e.g. a route-level or coordinator-level abort) to link into the job. */
  parentSignal?: AbortSignal
}

export interface OwnedJob {
  context: JobContext
  controller: AbortController
}

/**
 * Create a request-scoped job. The job owns its own controller; services must never share a mutable
 * controller across jobs. A parent signal, if provided, aborts this job when it aborts.
 */
export function createJobContext(params: CreateJobContextParams): OwnedJob {
  const controller = new AbortController()

  if (params.parentSignal) {
    if (params.parentSignal.aborted) {
      controller.abort()
    } else {
      params.parentSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  const context: JobContext = {
    operationId: uuidv4(),
    accountId: params.accountId,
    principal: params.principal,
    sessionGeneration: params.sessionGeneration,
    accountEpoch: params.accountEpoch,
    signal: controller.signal,
  }

  return { context, controller }
}

export interface JobEnvironment {
  activeAccountId: string | null
  sessionGeneration: number
  accountEpoch: number
}

/**
 * True when the job still speaks for its account and session: same active account, the session has
 * not been superseded, the account epoch has not advanced (no intervening removal), and the job is
 * not cancelled. Persistence commits and UI-mutating callbacks must gate on this.
 */
export function isContextCurrent(context: JobContext, environment: JobEnvironment): boolean {
  if (context.signal.aborted) {
    return false
  }

  if (environment.activeAccountId !== context.accountId) {
    return false
  }

  if (environment.sessionGeneration !== context.sessionGeneration) {
    return false
  }

  if (environment.accountEpoch !== context.accountEpoch) {
    return false
  }

  return true
}

/**
 * A commit may land only when the owning account epoch is unchanged. This is deliberately narrower
 * than {@link isContextCurrent}: a write for account A must be rejected once A has been removed
 * (epoch advanced), even if the user has since switched to account B and back. When the caller
 * sources `accountEpoch` from the accounts store (localStorage-backed), this fence is also cross-tab.
 * Broader cross-tab invalidation of cached account/ownership state is handled separately.
 */
export function isCommitAllowed(
  context: JobContext,
  environment: Pick<JobEnvironment, 'accountEpoch'>,
): boolean {
  if (context.signal.aborted) {
    return false
  }

  return environment.accountEpoch === context.accountEpoch
}
