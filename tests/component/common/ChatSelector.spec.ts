import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChatSelector from '@/components/telegram/ChatSelector.vue'
import { i18n } from '@/i18n'
import type { ChatInfo } from '@/types'

function createChat(id: number, overrides: Partial<ChatInfo> = {}): ChatInfo {
  return {
    id: BigInt(id),
    title: `Chat ${id}`,
    type: 'user',
    canExport: false,
    canSend: true,
    isAdmin: false,
    ...overrides,
  }
}

const chats: ChatInfo[] = [
  createChat(1, { title: 'Alice', username: 'alice' }),
  createChat(2, { title: 'Private Group', type: 'group' }),
  createChat(3, {
    title: 'Public Group',
    type: 'supergroup',
    username: 'public_group',
    isAdmin: true,
    participantCount: 100,
  }),
  createChat(4, {
    title: 'Read-only News',
    type: 'channel',
    username: 'news',
    canSend: false,
  }),
]

function mountSelector(props: Record<string, unknown> = {}) {
  return mount(ChatSelector, {
    props: { chats, ...props },
    global: { plugins: [i18n] },
  })
}

describe('ChatSelector', () => {
  it('filters by the most useful chat facets and resets them', async () => {
    const wrapper = mountSelector()

    expect(wrapper.text()).toContain('Direct messages')
    expect(wrapper.text()).toContain('Groups')
    expect(wrapper.text()).toContain('Channels')
    expect(wrapper.text()).toContain('4 of 4 chats')

    await wrapper.get('input[value="channels"]').setValue(false)
    expect(wrapper.text()).not.toContain('Read-only News')
    expect(wrapper.text()).toContain('3 of 4 chats')

    const publicFilter = wrapper
      .findAll('label')
      .find((label) => label.text().includes('Public chats only'))
    await publicFilter!.get('input').setValue(true)
    expect(wrapper.text()).not.toContain('Alice')
    expect(wrapper.text()).not.toContain('Private Group')
    expect(wrapper.text()).toContain('Public Group')

    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).toContain('4 of 4 chats')
  })

  it('supports multi-selection, selected-only filtering, and visible bulk actions', async () => {
    const wrapper = mountSelector({
      selectedIds: new Set(['3']),
      config: { mode: 'multiple' },
    })

    const selectedOnlyFilter = wrapper
      .findAll('label')
      .find((label) => label.text().includes('Selected only'))
    await selectedOnlyFilter!.get('input').setValue(true)
    expect(wrapper.text()).toContain('Public Group')
    expect(wrapper.text()).not.toContain('Alice')

    const bulkCheckbox = wrapper
      .findAll('label')
      .find((label) => label.text().includes('Select visible'))
    await bulkCheckbox!.get('input').setValue(false)
    expect(wrapper.emitted('set-visible')).toEqual([[[chats[2]], false]])

    await wrapper
      .findAll('label')
      .find((label) => label.text().includes('Public Group'))!
      .get('input[type="checkbox"]')
      .setValue(false)
    expect(wrapper.emitted('toggle')?.[0]).toEqual([chats[2]])
  })

  it('honors tool constraints and a compact single-select configuration', async () => {
    const wrapper = mountSelector({
      selectedIds: ['3'],
      config: {
        requiredCapabilities: ['canSend'],
        filters: { publicOnly: false, adminOnly: false, sendableOnly: false },
        display: { badges: false, participants: false, density: 'compact' },
      },
    })

    expect(wrapper.text()).not.toContain('Read-only News')
    expect(wrapper.text()).not.toContain('Public chats only')

    await wrapper.findAll('button').find((button) => button.text().includes('Public Group'))!.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([chats[2]])
  })

  it('resets to tool defaults and never applies hidden user filters', async () => {
    const wrapper = mountSelector({
      config: {
        defaultCategories: ['groups'],
        filters: { publicOnly: false },
      },
    })

    expect(wrapper.text()).toContain('Private Group')
    expect(wrapper.text()).not.toContain('Alice')
    expect(wrapper.text()).not.toContain('Reset')

    await wrapper.get('input[value="channels"]').setValue(true)
    expect(wrapper.text()).toContain('Read-only News')
    await wrapper.get('button').trigger('click')

    expect(wrapper.text()).toContain('Private Group')
    expect(wrapper.text()).not.toContain('Read-only News')
    expect(wrapper.text()).not.toContain('Public chats only')
  })
})
