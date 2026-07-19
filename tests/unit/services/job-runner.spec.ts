import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createJobContext } from '@/services/jobs/job-context'
import { cancelJob, isJobRunning, runJob } from '@/services/jobs/job-runner'
import { useJobsStore } from '@/stores/jobs'
import type { TelegramPrincipal } from '@/types'

const principal: TelegramPrincipal = { kind: 'user', telegramUserId: '100' }

function newJob() {
  return createJobContext({
    accountId: 'account-a',
    principal,
    sessionGeneration: 1,
    accountEpoch: 0,
  })
}

describe('job-runner', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('registers a running job, pipes progress, and settles it succeeded', async () => {
    const store = useJobsStore()
    const { context, controller } = newJob()

    const result = await runJob({
      context,
      controller,
      kind: 'export',
      title: 'Export',
      execute: async ({ onProgress }) => {
        onProgress({ current: 5, total: 10 })
        expect(store.getJob(context.operationId)?.progress).toEqual({ current: 5, total: 10 })
        return 'done'
      },
    })

    expect(result).toBe('done')
    expect(store.getJob(context.operationId)?.status).toBe('succeeded')
    expect(isJobRunning(context.operationId)).toBe(false)
  })

  it('settles failed and rethrows when the work throws', async () => {
    const store = useJobsStore()
    const { context, controller } = newJob()

    await expect(
      runJob({
        context,
        controller,
        kind: 'export',
        title: 'Export',
        execute: async () => {
          throw new Error('boom')
        },
      }),
    ).rejects.toThrow('boom')

    expect(store.getJob(context.operationId)).toMatchObject({ status: 'failed', error: 'boom' })
    expect(isJobRunning(context.operationId)).toBe(false)
  })

  it('cancelJob aborts the running work and settles it cancelled', async () => {
    const store = useJobsStore()
    const { context, controller } = newJob()

    const promise = runJob({
      context,
      controller,
      kind: 'chat-history',
      title: 'Chat export',
      execute: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    })

    // Let the job register before cancelling from "the shell".
    await Promise.resolve()
    expect(store.getJob(context.operationId)?.status).toBe('running')

    cancelJob(context.operationId)
    await expect(promise).rejects.toThrow('aborted')

    expect(store.getJob(context.operationId)?.status).toBe('cancelled')
    expect(isJobRunning(context.operationId)).toBe(false)
  })

  it('records a job as cancelled even if the work resolves after an abort', async () => {
    const store = useJobsStore()
    const { context, controller } = newJob()

    const promise = runJob({
      context,
      controller,
      kind: 'export',
      title: 'Export',
      // Work ignores the signal and resolves successfully after being aborted.
      execute: async ({ signal }) => {
        await Promise.resolve()
        expect(signal.aborted).toBe(true)
        return 'late-success'
      },
    })

    controller.abort()
    await promise

    expect(store.getJob(context.operationId)?.status).toBe('cancelled')
  })

  it('cancelJob is a no-op for an unknown operation id', () => {
    expect(() => cancelJob('missing')).not.toThrow()
  })
})
