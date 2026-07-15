import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import type { ChatExport } from '@/types'
import ExportsList from '@/modules/llm-export/components/ExportsList.vue'

function createChatExport(overrides: Partial<ChatExport> = {}): ChatExport {
  return {
    id: 'export-1',
    chatId: BigInt('100123'),
    chatPeerId: '-100100123',
    chatTitle: 'Test Chat',
    chatType: 'supergroup',
    schemaVersion: 2,
    createdAt: new Date('2024-03-10T12:00:00Z'),
    messageCount: 10,
    hasMedia: true,
    mediaCount: 2,
    dateRange: {
      from: new Date('2024-03-10T10:00:00Z'),
      to: new Date('2024-03-10T12:00:00Z'),
    },
    ...overrides,
  }
}

describe('ExportsList', () => {
  it('renders legacy and archived state with explicit lifecycle actions', () => {
    const wrapper = mount(ExportsList, {
      props: {
        exports: [
          createChatExport({
            id: 'legacy-export',
            chatTitle: 'Legacy Export',
            ownershipState: 'legacy',
          }),
        ],
        archivedExports: [
          createChatExport({
            id: 'archived-export',
            chatTitle: 'Archived Export',
            ownershipState: 'archived',
            ownerAccountPhone: '+1234567890',
            archivedAt: new Date('2024-03-11T12:00:00Z'),
          }),
        ],
        quarantinedExports: [],
        canReconcile: true,
        isLoadingList: false,
        isLoadingSelection: false,
      },
      global: {
        plugins: [i18n],
      },
    })

    expect(wrapper.text()).toContain('Unassigned local data')
    expect(wrapper.text()).toContain('Archived local exports')
    expect(wrapper.text()).toContain('Removed account: +1234567890')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Claim')).toBe(true)
  })

  it('surfaces quarantined exports with a repair action and emits reconcile', async () => {
    const wrapper = mount(ExportsList, {
      props: {
        exports: [],
        archivedExports: [],
        quarantinedExports: [
          createChatExport({
            id: 'broken-export',
            chatTitle: 'Broken Export',
            ownerVerification: 'verified',
            ownershipState: 'owned',
          }),
        ],
        canReconcile: true,
        isLoadingList: false,
        isLoadingSelection: false,
      },
      global: {
        plugins: [i18n],
      },
    })

    expect(wrapper.text()).toContain('Broken Export')
    const repairButton = wrapper.findAll('button').find((button) => button.text() === 'Repair')
    expect(repairButton).toBeDefined()
    await repairButton!.trigger('click')

    expect(wrapper.emitted('reconcile')?.[0]).toEqual(['broken-export'])
  })

  it('hides the repair action when the account cannot reconcile', () => {
    const wrapper = mount(ExportsList, {
      props: {
        exports: [],
        archivedExports: [],
        quarantinedExports: [
          createChatExport({
            id: 'broken-export',
            chatTitle: 'Broken Export',
            ownerVerification: 'verified',
            ownershipState: 'owned',
          }),
        ],
        canReconcile: false,
        isLoadingList: false,
        isLoadingSelection: false,
      },
      global: {
        plugins: [i18n],
      },
    })

    expect(wrapper.findAll('button').some((button) => button.text() === 'Repair')).toBe(false)
  })

  it('emits claim for legacy exports', async () => {
    const wrapper = mount(ExportsList, {
      props: {
        exports: [
          createChatExport({
            id: 'legacy-export',
            chatTitle: 'Legacy Export',
            ownershipState: 'legacy',
          }),
        ],
        archivedExports: [],
        quarantinedExports: [],
        canReconcile: true,
        isLoadingList: false,
        isLoadingSelection: false,
      },
      global: {
        plugins: [i18n],
      },
    })

    const claimButton = wrapper.findAll('button').find((button) => button.text() === 'Claim')
    expect(claimButton).toBeDefined()
    await claimButton!.trigger('click')

    expect(wrapper.emitted('claim')).toBeTruthy()
    expect(wrapper.emitted('claim')?.[0]).toEqual(['legacy-export'])
  })
})
