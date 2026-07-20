/**
 * Job runner.
 *
 * Owns the lifetime of a long-running job independent of any route component: it holds the job's
 * `AbortController`, mirrors progress into the shell registry (`useJobsStore`), and settles the job
 * exactly once. Because the runner — not the view — owns the controller and the in-flight promise,
 * navigating away from a route does not cancel or orphan the work. Cancellation is
 * available from anywhere (e.g. the app-shell job surface) via {@link cancelJob}.
 */
import { useJobsStore } from '@/stores/jobs'
import type { JobContext, JobKind, JobProgress } from '@/types'

const controllers = new Map<string, AbortController>()

export interface RunJobParams<T> {
  context: JobContext
  controller: AbortController
  kind: JobKind
  title: string
  execute: (helpers: {
    signal: AbortSignal
    onProgress: (progress: JobProgress) => void
  }) => Promise<T>
}

function isAbort(signal: AbortSignal, error: unknown): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
}

/**
 * Register, run, and settle a job. The returned promise resolves/rejects with the work's result, but
 * the job's completion is recorded in the registry regardless of whether any caller is still awaiting
 * it — so a route can start a job and then unmount without affecting the job's lifetime.
 */
export async function runJob<T>(params: RunJobParams<T>): Promise<T> {
  const { context, controller, kind, title, execute } = params
  const store = useJobsStore()

  controllers.set(context.operationId, controller)
  store.registerFromContext(context, { kind, title })

  try {
    const result = await execute({
      signal: context.signal,
      onProgress: (progress) => store.updateProgress(context.operationId, progress),
    })
    // settle() independently downgrades this to 'cancelled' if the owner already aborted.
    store.settle(context.operationId, 'succeeded')
    return result
  } catch (error) {
    if (isAbort(context.signal, error)) {
      store.settle(context.operationId, 'cancelled')
    } else {
      store.settle(
        context.operationId,
        'failed',
        error instanceof Error ? error.message : String(error),
      )
    }
    throw error
  } finally {
    controllers.delete(context.operationId)
  }
}

/** Abort a running job by operation id. No-op if the job already settled or is unknown. */
export function cancelJob(operationId: string): void {
  controllers.get(operationId)?.abort()
}

/** True while the runner still owns a live controller for this job. */
export function isJobRunning(operationId: string): boolean {
  return controllers.has(operationId)
}
