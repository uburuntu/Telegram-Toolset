import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import type { SavedAccount } from '@/types'

const mocks = vi.hoisted(() => ({
  loadAccountProfilePhoto: vi.fn(),
  photoUrlFor: vi.fn(),
  pruneAccountProfilePhotos: vi.fn(),
}))

vi.mock('@/composables', () => ({
  useAccountProfilePhotos: () => mocks,
}))

import AccountSwitcher from '@/components/auth/AccountSwitcher.vue'
import { useAccountsStore } from '@/stores'

const account: SavedAccount = {
  id: 'account-a',
  type: 'user',
  label: 'Alice Example',
  firstName: 'Alice',
  username: 'alice',
  sessionString: 'session',
  createdAt: new Date('2025-01-10T12:00:00Z'),
  lastUsedAt: new Date('2026-07-30T18:00:00Z'),
}

describe('AccountSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    setActivePinia(createPinia())
    mocks.photoUrlFor.mockImplementation((accountId: string | undefined) =>
      accountId === account.id ? 'blob:alice-avatar' : null,
    )
  })

  it('shows the active profile photo in the trigger and account list', async () => {
    const accounts = useAccountsStore()
    accounts.accounts = [account]
    accounts.activeAccountId = account.id
    accounts.markAccountSessionReady(account.id)

    const wrapper = mount(AccountSwitcher, {
      global: { plugins: [i18n] },
    })
    await flushPromises()

    const trigger = wrapper.get('[data-testid="account-menu-trigger"]')
    expect(trigger.attributes('aria-label')).toBe('Alice')
    expect(trigger.get('[data-testid="account-avatar-image"]').attributes('src')).toBe(
      'blob:alice-avatar',
    )
    expect(mocks.loadAccountProfilePhoto).toHaveBeenCalledWith(account.id)

    await trigger.trigger('click')

    expect(wrapper.findAll('[data-testid="account-avatar-image"]')).toHaveLength(2)
    expect(trigger.attributes('aria-expanded')).toBe('true')
  })
})
