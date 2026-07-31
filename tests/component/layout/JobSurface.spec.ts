import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { cancelJob } from '@/services/jobs/job-runner'
import { useJobsStore } from '@/stores'
import type { RegisterJobInput } from '@/stores/jobs'
import type { TelegramPrincipal } from '@/types'
import JobSurface from '@/components/layout/JobSurface.vue'

vi.mock('@/services/jobs/job-runner', () => ({
  cancelJob: vi.fn(),
}))

const principal: TelegramPrincipal = { kind: 'user', telegramUserId: '100' }

function jobInput(overrides: Partial<RegisterJobInput> = {}): RegisterJobInput {
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

function mountSurface() {
  return mount(JobSurface, { global: { plugins: [i18n] } })
}

describe('JobSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('renders nothing when there are no jobs', () => {
    const wrapper = mountSurface()
    expect(wrapper.find('section').exists()).toBe(false)
  })

  it('shows a running job with progress and cancels it via the runner', async () => {
    const store = useJobsStore()
    store.register(jobInput())
    store.updateProgress('op-1', { current: 3, total: 12, label: 'Downloading' })

    const wrapper = mountSurface()
    expect(wrapper.text()).toContain('Export deleted messages')
    expect(wrapper.text()).toContain('3/12')

    const bar = wrapper.find('.bg-blue-600')
    expect(bar.attributes('style')).toContain('width: 25%')

    await wrapper.find('button').trigger('click')
    expect(cancelJob).toHaveBeenCalledWith('op-1')
  })

  it('shows a settled job without a cancel button and clears completed jobs', async () => {
    const store = useJobsStore()
    store.register(jobInput({ operationId: 'done' }))
    store.settle('done', 'failed', 'network error')

    const wrapper = mountSurface()
    expect(wrapper.text()).toContain('network error')
    // No per-job cancel button for a settled job.
    expect(wrapper.findAll('button').some((b) => b.text() === i18n.global.t('common.cancel'))).toBe(
      false,
    )

    const clearButton = wrapper
      .findAll('button')
      .find((b) => b.text() === i18n.global.t('jobs.clearCompleted'))
    expect(clearButton).toBeDefined()
    await clearButton?.trigger('click')

    expect(store.recentJobs).toHaveLength(0)
  })

  it('keeps completed jobs distinguishable by target while preserving the status label', () => {
    const store = useJobsStore()
    store.register(
      jobInput({
        operationId: 'archive-chat',
        kind: 'trace-delete',
        title: 'Delete my messages · Public Archive Chat',
      }),
    )
    store.settle('archive-chat', 'succeeded')
    store.register(
      jobInput({
        operationId: 'project-chat',
        kind: 'trace-delete',
        title: 'Delete my messages · A very long project chat name that needs truncation',
      }),
    )
    store.settle('project-chat', 'succeeded')

    const wrapper = mountSurface()
    const titles = wrapper.findAll('li span[title]')

    expect(titles.map((title) => title.attributes('title'))).toEqual([
      'Delete my messages · Public Archive Chat',
      'Delete my messages · A very long project chat name that needs truncation',
    ])
    expect(titles.every((title) => title.classes().includes('min-w-0'))).toBe(true)
    expect(wrapper.findAll('li').every((row) => row.text().includes('Completed'))).toBe(true)
    expect(wrapper.findAll('li span.shrink-0')).toHaveLength(2)
  })
})
