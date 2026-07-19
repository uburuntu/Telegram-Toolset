import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { quotaManager } from '@/services/storage/quota'
import PersistenceNotice from '@/components/storage/PersistenceNotice.vue'

vi.mock('@/services/storage/quota', () => ({
  quotaManager: { getPersistenceStatus: vi.fn() },
}))

function mountNotice() {
  return mount(PersistenceNotice, { global: { plugins: [i18n] } })
}

describe('PersistenceNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when storage is persisted', async () => {
    vi.mocked(quotaManager.getPersistenceStatus).mockResolvedValue('persisted')

    const wrapper = mountNotice()
    await flushPromises()

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('warns that best-effort storage is not a durable backup', async () => {
    vi.mocked(quotaManager.getPersistenceStatus).mockResolvedValue('best-effort')

    const wrapper = mountNotice()
    await flushPromises()

    expect(wrapper.text()).toContain(i18n.global.t('persistence.bestEffortTitle'))
    expect(wrapper.text()).toContain(i18n.global.t('persistence.body'))
  })

  it('warns when storage durability is unsupported', async () => {
    vi.mocked(quotaManager.getPersistenceStatus).mockResolvedValue('unsupported')

    const wrapper = mountNotice()
    await flushPromises()

    expect(wrapper.text()).toContain(i18n.global.t('persistence.unsupportedTitle'))
    expect(wrapper.text()).toContain(i18n.global.t('persistence.body'))
  })
})
