import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_RECENT_JOBS, useJobsStore } from '@/stores/jobs'
import type { RegisterJobInput } from '@/stores/jobs'
import type { TelegramPrincipal } from '@/types'

const principal: TelegramPrincipal = { kind: 'user', telegramUserId: '100' }

function input(overrides: Partial<RegisterJobInput> = {}): RegisterJobInput {
  return {
    operationId: 'op-1',
    kind: 'export',
    title: 'Export deleted messages',
    accountId: 'account-a',
    principal,
    sessionGeneration: 1,
    accountEpoch: 0,
    ...overrides,
  }
}

describe('useJobsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('registers a running job and surfaces it as active', () => {
    const store = useJobsStore()
    store.register(input())

    expect(store.hasActiveJobs).toBe(true)
    expect(store.activeJobs).toHaveLength(1)
    expect(store.recentJobs).toHaveLength(0)
    expect(store.getJob('op-1')?.status).toBe('running')
  })

  it('updates progress only while running', () => {
    const store = useJobsStore()
    store.register(input())
    store.updateProgress('op-1', { current: 3, total: 10, label: 'Downloading' })
    expect(store.getJob('op-1')?.progress).toEqual({ current: 3, total: 10, label: 'Downloading' })

    store.settle('op-1', 'succeeded')
    store.updateProgress('op-1', { current: 10, total: 10 })
    // Progress must not change after the job settled.
    expect(store.getJob('op-1')?.progress).toEqual({ current: 3, total: 10, label: 'Downloading' })
  })

  it('moves a settled job from active to recent', () => {
    const store = useJobsStore()
    store.register(input())
    store.settle('op-1', 'failed', 'boom')

    expect(store.hasActiveJobs).toBe(false)
    expect(store.activeJobs).toHaveLength(0)
    expect(store.recentJobs).toHaveLength(1)
    expect(store.getJob('op-1')).toMatchObject({ status: 'failed', error: 'boom' })
  })

  it('replaces a record with the same operation id instead of duplicating', () => {
    const store = useJobsStore()
    store.register(input())
    store.register(input({ title: 'Export (retry)' }))

    expect(store.jobs).toHaveLength(1)
    expect(store.getJob('op-1')?.title).toBe('Export (retry)')
  })

  it('filters jobs by account', () => {
    const store = useJobsStore()
    store.register(input({ operationId: 'op-a', accountId: 'account-a' }))
    store.register(input({ operationId: 'op-b', accountId: 'account-b' }))

    expect(store.jobsForAccount('account-a').map((job) => job.operationId)).toEqual(['op-a'])
  })

  it('caps the retained recent jobs', () => {
    const store = useJobsStore()
    for (let index = 0; index < MAX_RECENT_JOBS + 5; index += 1) {
      const operationId = `op-${index}`
      store.register(input({ operationId }))
      store.settle(operationId, 'succeeded')
    }

    expect(store.recentJobs.length).toBe(MAX_RECENT_JOBS)
    // The oldest settled jobs are pruned first.
    expect(store.getJob('op-0')).toBeUndefined()
    expect(store.getJob(`op-${MAX_RECENT_JOBS + 4}`)).toBeDefined()
  })

  it('clears recent jobs while keeping active ones', () => {
    const store = useJobsStore()
    store.register(input({ operationId: 'running' }))
    store.register(input({ operationId: 'done' }))
    store.settle('done', 'succeeded')

    store.clearRecent()

    expect(store.activeJobs.map((job) => job.operationId)).toEqual(['running'])
    expect(store.recentJobs).toHaveLength(0)
  })
})
