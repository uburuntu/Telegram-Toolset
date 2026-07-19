import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, type Pinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import {
  deleteLocalRecord,
  getLocalDataInventory,
  type LocalDataRecord,
  purgeRetainedLocalData,
} from '@/services/storage/local-data-service'
import { useAccountsStore } from '@/stores'
import LocalDataView from '@/views/LocalDataView.vue'

vi.mock('@/services/storage/local-data-service', () => ({
  getLocalDataInventory: vi.fn(),
  deleteLocalRecord: vi.fn(),
  purgeRetainedLocalData: vi.fn(),
}))

function record(overrides: Partial<LocalDataRecord> = {}): LocalDataRecord {
  return {
    id: 'b1',
    kind: 'backup',
    title: 'Archived chat',
    createdAt: new Date('2026-01-02T00:00:00Z'),
    messageCount: 5,
    sizeBytes: 2048,
    verification: 'verified',
    lifecycle: 'archived',
    health: 'healthy',
    archivedReason: 'account_removed',
    ...overrides,
  }
}

let pinia: Pinia

function mountView() {
  return mount(LocalDataView, { global: { plugins: [pinia, i18n] } })
}

function findButtonByText(wrapper: ReturnType<typeof mountView>, key: string) {
  const label = i18n.global.t(key)
  return wrapper.findAll('button').find((button) => button.text() === label)
}

describe('LocalDataView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pinia = createPinia()
    setActivePinia(pinia)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(getLocalDataInventory).mockResolvedValue({ records: [], totalSizeBytes: 0 })
    vi.mocked(purgeRetainedLocalData).mockResolvedValue({ backups: 0, chatExports: 0 })
  })

  it('shows the empty state and no stored credentials when nothing is retained', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain(i18n.global.t('localData.empty'))
    expect(wrapper.text()).toContain(i18n.global.t('localData.credentialsEmpty'))
    expect(findButtonByText(wrapper, 'localData.purge')).toBeUndefined()
  })

  it('renders each orphan record with its state and reason, but never its content', async () => {
    vi.mocked(getLocalDataInventory).mockResolvedValue({
      records: [
        record(),
        record({
          id: 'e1',
          kind: 'chat-export',
          title: 'Quarantined export',
          lifecycle: 'active',
          health: 'quarantined',
          verification: 'unverified',
          quarantineReason: 'owner_metadata_missing',
          archivedReason: undefined,
          sizeBytes: 1024,
        }),
      ],
      totalSizeBytes: 3072,
    })

    const wrapper = mountView()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Archived chat')
    expect(text).toContain('Quarantined export')
    expect(text).toContain(i18n.global.t('localData.state.archived'))
    expect(text).toContain(i18n.global.t('localData.state.quarantined'))
    expect(text).toContain(i18n.global.t('localData.reason.account_removed'))
    expect(text).toContain(i18n.global.t('localData.reason.owner_metadata_missing'))
  })

  it('deletes a single record through the ownership-enforced service and reloads', async () => {
    const rec = record()
    vi.mocked(getLocalDataInventory).mockResolvedValue({ records: [rec], totalSizeBytes: 2048 })

    const wrapper = mountView()
    await flushPromises()

    await findButtonByText(wrapper, 'localData.delete')?.trigger('click')
    await flushPromises()

    expect(deleteLocalRecord).toHaveBeenCalledWith(rec)
    // Reloaded after the mutation (initial mount + post-delete refresh).
    expect(getLocalDataInventory).toHaveBeenCalledTimes(2)
  })

  it('does not delete when the scoped confirmation is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.mocked(getLocalDataInventory).mockResolvedValue({ records: [record()], totalSizeBytes: 2048 })

    const wrapper = mountView()
    await flushPromises()

    await findButtonByText(wrapper, 'localData.delete')?.trigger('click')
    await flushPromises()

    expect(deleteLocalRecord).not.toHaveBeenCalled()
  })

  it('bulk purges exactly the retained inventory', async () => {
    vi.mocked(getLocalDataInventory).mockResolvedValue({ records: [record()], totalSizeBytes: 2048 })
    vi.mocked(purgeRetainedLocalData).mockResolvedValue({ backups: 1, chatExports: 0 })

    const wrapper = mountView()
    await flushPromises()

    await findButtonByText(wrapper, 'localData.purge')?.trigger('click')
    await flushPromises()

    expect(purgeRetainedLocalData).toHaveBeenCalledTimes(1)
  })

  it('clears stored credentials without an account', async () => {
    const accountsStore = useAccountsStore()
    accountsStore.apiCredentials = { apiId: 123, apiHash: 'abcdef0123456789abcdef0123456789' }
    const clearSpy = vi.spyOn(accountsStore, 'clearApiCredentials').mockResolvedValue()

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain(i18n.global.t('localData.credentialsStored'))
    await findButtonByText(wrapper, 'localData.clearCredentials')?.trigger('click')
    await flushPromises()

    expect(clearSpy).toHaveBeenCalledTimes(1)
  })
})
