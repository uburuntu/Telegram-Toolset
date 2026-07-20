/**
 * Shell job registry.
 *
 * A pure, observable projection of active and recently completed jobs so the app shell can surface
 * long-running work independent of any route. Route changes must not destroy this state, and the
 * registry never owns a job's `AbortController` — cancellation stays with the job owner.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { JobContext, JobKind, JobProgress, JobRecord, JobStatus } from '@/types'

/** How many settled jobs to retain for the "recently completed" shell surface. */
export const MAX_RECENT_JOBS = 20

export interface RegisterJobInput {
  operationId: string
  kind: JobKind
  title: string
  accountId: string
  principal: JobRecord['principal']
  sessionGeneration: number
  accountEpoch: number
  progress?: JobProgress
}

export const useJobsStore = defineStore('jobs', () => {
  const jobs = ref<JobRecord[]>([])

  // Live abort signals for context-registered running jobs, kept out of the serializable JobRecord so
  // the projection stays pure. Used only to defensively reclassify a settle() call (see settle()).
  const signals = new Map<string, AbortSignal>()

  const activeJobs = computed(() => jobs.value.filter((job) => job.status === 'running'))
  const recentJobs = computed(() => jobs.value.filter((job) => job.status !== 'running'))
  const hasActiveJobs = computed(() => activeJobs.value.length > 0)

  function jobsForAccount(accountId: string): JobRecord[] {
    return jobs.value.filter((job) => job.accountId === accountId)
  }

  function getJob(operationId: string): JobRecord | undefined {
    return jobs.value.find((job) => job.operationId === operationId)
  }

  function register(input: RegisterJobInput): JobRecord {
    const now = new Date()
    const record: JobRecord = {
      operationId: input.operationId,
      kind: input.kind,
      title: input.title,
      accountId: input.accountId,
      principal: input.principal,
      sessionGeneration: input.sessionGeneration,
      accountEpoch: input.accountEpoch,
      status: 'running',
      progress: input.progress,
      createdAt: now,
      updatedAt: now,
    }

    // Replace any prior record with the same operation id rather than duplicating.
    signals.delete(input.operationId)
    jobs.value = [...jobs.value.filter((job) => job.operationId !== input.operationId), record]
    return record
  }

  function registerFromContext(
    context: JobContext,
    meta: { kind: JobKind; title: string; progress?: JobProgress },
  ): JobRecord {
    const record = register({
      operationId: context.operationId,
      kind: meta.kind,
      title: meta.title,
      accountId: context.accountId,
      principal: context.principal,
      sessionGeneration: context.sessionGeneration,
      accountEpoch: context.accountEpoch,
      progress: meta.progress,
    })
    signals.set(context.operationId, context.signal)
    return record
  }

  function updateProgress(operationId: string, progress: JobProgress): void {
    const job = getJob(operationId)
    if (!job || job.status !== 'running') {
      return
    }
    job.progress = progress
    job.updatedAt = new Date()
  }

  function settle(operationId: string, status: JobStatus, error?: string): void {
    const job = getJob(operationId)
    if (!job) {
      return
    }
    // A job whose owner already aborted must never be recorded as a success, even if a late caller
    // reports 'succeeded' after cancellation.
    const effectiveStatus =
      status === 'succeeded' && signals.get(operationId)?.aborted ? 'cancelled' : status
    job.status = effectiveStatus
    job.error = error
    job.updatedAt = new Date()
    signals.delete(operationId)
    pruneRecent()
  }

  function pruneRecent(): void {
    const settled = jobs.value.filter((job) => job.status !== 'running')
    if (settled.length <= MAX_RECENT_JOBS) {
      return
    }

    const excess = settled
      .slice()
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, settled.length - MAX_RECENT_JOBS)
    const excessIds = new Set(excess.map((job) => job.operationId))
    jobs.value = jobs.value.filter((job) => !excessIds.has(job.operationId))
  }

  function clearRecent(): void {
    jobs.value = jobs.value.filter((job) => job.status === 'running')
  }

  return {
    jobs,
    activeJobs,
    recentJobs,
    hasActiveJobs,
    jobsForAccount,
    getJob,
    register,
    registerFromContext,
    updateProgress,
    settle,
    clearRecent,
  }
})
