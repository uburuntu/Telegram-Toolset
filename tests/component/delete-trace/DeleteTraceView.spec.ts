import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import DeleteTraceView from '@/modules/delete-trace/DeleteTraceView.vue'
import { useAccountsStore } from '@/stores'
import type { ChatInfo } from '@/types'
import en from '@/i18n/locales/en.json'

const mocks = vi.hoisted(() => ({
  getDialogs: vi.fn(),
  scan: vi.fn(),
  delete: vi.fn(),
  runJob: vi.fn(),
  cancelJob: vi.fn(),
  getSessionSnapshot: vi.fn(() => ({ status: 'active', accountId: 'account-a', generation: 1 })),
}))

vi.mock('@/services/telegram/gateway', () => ({
  telegramGateway: {
    auth: {
      user: { id: BigInt(100), firstName: 'Alice' },
    },
    dialogs: {
      getDialogs: mocks.getDialogs,
    },
  },
}))

vi.mock('@/services/delete-trace/delete-trace-service', () => ({
  deleteTraceService: {
    scan: mocks.scan,
    delete: mocks.delete,
  },
}))

vi.mock('@/services/jobs/job-runner', () => ({
  runJob: mocks.runJob,
  cancelJob: mocks.cancelJob,
}))

vi.mock('@/services/telegram/session-coordinator-instance', () => ({
  sessionCoordinator: {
    getSnapshot: mocks.getSessionSnapshot,
  },
}))

const chats: ChatInfo[] = [
  {
    id: BigInt(10),
    title: 'Public Archive Chat',
    type: 'supergroup',
    username: 'archive_chat',
    canExport: false,
    canSend: true,
    isAdmin: false,
    lastMessageDate: new Date('2021-05-01T00:00:00.000Z'),
  },
  {
    id: BigInt(20),
    title: 'Project Group',
    type: 'group',
    canExport: false,
    canSend: true,
    isAdmin: false,
    lastMessageDate: new Date('2025-01-01T00:00:00.000Z'),
  },
]

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}

function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const accounts = useAccountsStore()
  accounts.accounts = [
    {
      id: 'account-a',
      type: 'user',
      label: 'Alice',
      principal: { kind: 'user', telegramUserId: '100' },
      sessionString: 'session',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      lastUsedAt: new Date('2025-01-01T00:00:00.000Z'),
    },
  ]
  accounts.activeAccountId = 'account-a'

  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  return mount(DeleteTraceView, { global: { plugins: [pinia, i18n] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocks.getDialogs.mockResolvedValue(chats)
  mocks.getSessionSnapshot.mockReturnValue({
    status: 'active',
    accountId: 'account-a',
    generation: 1,
  })
  mocks.runJob.mockImplementation(
    async (params: {
      context: { signal: AbortSignal }
      execute: (helpers: {
        signal: AbortSignal
        onProgress: (progress: unknown) => void
      }) => Promise<unknown>
    }) => params.execute({ signal: params.context.signal, onProgress: vi.fn() }),
  )
})

describe('DeleteTraceView', () => {
  it('runs the reviewed multi-step deletion workflow and renders per-chat outcomes', async () => {
    const scanResult = {
      chats: [
        {
          chat: chats[0]!,
          messageIds: [30, 20, 10],
          messages: [
            {
              id: 30,
              date: new Date('2021-01-01T00:00:00.000Z'),
              preview: { kind: 'text' as const, text: 'A message that will be deleted' },
            },
            {
              id: 20,
              date: new Date('2020-06-01T00:00:00.000Z'),
              preview: { kind: 'non_text' as const },
            },
            {
              id: 10,
              date: new Date('2020-01-01T00:00:00.000Z'),
              preview: { kind: 'text' as const, text: '<b>Rendered as text</b>' },
            },
          ],
          oldestDate: new Date('2020-01-01T00:00:00.000Z'),
          newestDate: new Date('2021-01-01T00:00:00.000Z'),
        },
      ],
      totalMessages: 3,
      failedChats: 0,
    }
    mocks.scan.mockImplementation(
      async (
        _chats: ChatInfo[],
        _range: unknown,
        callbacks: { onProgress?: (progress: unknown) => void },
      ) => {
        callbacks.onProgress?.({
          processedChats: 1,
          totalChats: 1,
          foundMessages: 3,
          currentChatFound: 3,
        })
        return scanResult
      },
    )
    mocks.delete.mockImplementation(
      async (
        _scans: unknown,
        callbacks: { onProgress?: (progress: unknown) => void },
      ) => {
        callbacks.onProgress?.({
          processedBatches: 1,
          totalBatches: 1,
          confirmedMessages: 3,
          requestedMessages: 3,
          currentChat: chats[0]!.title,
        })
        return {
          outcomes: [{ peerId: '10', status: 'delivered', affected: 3 }],
          requestedMessages: 3,
        }
      },
    )

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.text()).toContain('Public Archive Chat')
    const archiveLabel = wrapper
      .findAll('label')
      .find((label) => label.text().includes('Public Archive Chat'))
    expect(archiveLabel).toBeDefined()
    await archiveLabel!.find('input[type="checkbox"]').setValue(true)
    await buttonByText(wrapper, 'Next').trigger('click')

    await wrapper.get('#delete-trace-from-date').setValue('2020-01-01')
    await wrapper.get('#delete-trace-through-date').setValue('2021-12-31')
    await buttonByText(wrapper, 'Scan my messages').trigger('click')
    await flushPromises()

    expect(mocks.scan).toHaveBeenCalledWith(
      [chats[0]],
      {
        minDate: new Date(2020, 0, 1, 0, 0, 0, 0),
        maxDate: new Date(2021, 11, 31, 23, 59, 59, 999),
      },
      expect.any(Object),
      expect.any(AbortSignal),
    )
    expect(wrapper.text()).toContain('Found 3 messages across 1 chats.')
    expect(wrapper.text()).toContain('Message preview')
    expect(wrapper.text()).toContain('A message that will be deleted')
    expect(wrapper.text()).toContain('[Media or sticker]')
    expect(wrapper.text()).toContain('<b>Rendered as text</b>')
    expect(wrapper.find('b').exists()).toBe(false)

    const confirmation = wrapper.find('input[type="checkbox"]')
    await confirmation.setValue(true)
    await buttonByText(wrapper, 'Delete 3 messages').trigger('click')
    await flushPromises()

    expect(mocks.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'trace-delete',
        title: 'Delete my messages · Public Archive Chat',
      }),
    )
    expect(mocks.delete).toHaveBeenCalledWith(
      scanResult.chats,
      expect.any(Object),
      expect.any(AbortSignal),
    )
    expect(wrapper.text()).toContain('Deletion results')
    expect(wrapper.text()).toContain('Confirmed 3 of 3 requested deletions.')
    expect(wrapper.text()).toContain('Public Archive Chat')
    expect(wrapper.text()).toContain('Deleted')
  })

  it('identifies a multi-chat deletion in the background job title', async () => {
    const scanResult = {
      chats: chats.map((chat, index) => ({
        chat,
        messageIds: [index + 1],
        messages: [
          {
            id: index + 1,
            date: new Date('2024-01-01T00:00:00.000Z'),
            preview: { kind: 'text' as const, text: `Message ${index + 1}` },
          },
        ],
      })),
      totalMessages: 2,
      failedChats: 0,
    }
    mocks.scan.mockResolvedValue(scanResult)
    mocks.delete.mockResolvedValue({
      outcomes: chats.map((chat) => ({
        peerId: chat.id.toString(),
        status: 'delivered' as const,
        affected: 1,
      })),
      requestedMessages: 2,
    })

    const wrapper = mountView()
    await flushPromises()

    for (const title of ['Public Archive Chat', 'Project Group']) {
      const label = wrapper.findAll('label').find((candidate) => candidate.text().includes(title))
      await label!.find('input[type="checkbox"]').setValue(true)
    }
    await buttonByText(wrapper, 'Next').trigger('click')
    await buttonByText(wrapper, 'Scan my messages').trigger('click')
    await flushPromises()

    await wrapper.find('input[type="checkbox"]').setValue(true)
    await buttonByText(wrapper, 'Delete 2 messages').trigger('click')
    await flushPromises()

    expect(mocks.runJob).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'trace-delete',
        title: 'Delete my messages · Public Archive Chat + 1 more',
      }),
    )
  })

  it('rejects an inverted date range without issuing a Telegram scan', async () => {
    const wrapper = mountView()
    await flushPromises()

    const archiveLabel = wrapper
      .findAll('label')
      .find((label) => label.text().includes('Public Archive Chat'))
    await archiveLabel!.find('input[type="checkbox"]').setValue(true)
    await buttonByText(wrapper, 'Next').trigger('click')
    await wrapper.get('#delete-trace-from-date').setValue('2025-01-01')
    await wrapper.get('#delete-trace-through-date').setValue('2024-01-01')
    await buttonByText(wrapper, 'Scan my messages').trigger('click')

    expect(mocks.scan).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain(
      'The from date must be earlier than or equal to the through date.',
    )
  })
})
