import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ConnectionStatusBar from '@/components/layout/ConnectionStatusBar.vue'
import { i18n } from '@/i18n'
import { useAccountsStore } from '@/stores'
import type { ConnectionState } from '@/types'

const gatewayMock = vi.hoisted(() => {
  const listeners = {
    connection: null as ((state: ConnectionState) => void) | null,
    floodWait: null as ((seconds: number, method: string) => void) | null,
  }
  const gateway = {
    connectionState: 'connected' as ConnectionState,
    onConnectionStateChange: vi.fn((listener: (state: ConnectionState) => void) => {
      listeners.connection = listener
      return vi.fn()
    }),
    onFloodWait: vi.fn((listener: (seconds: number, method: string) => void) => {
      listeners.floodWait = listener
      return vi.fn()
    }),
    canManualReconnect: vi.fn(() => true),
    manualReconnect: vi.fn(async () => true),
  }

  return { gateway, listeners }
})

vi.mock('@/services/telegram/gateway', () => ({
  telegramAuthGateway: gatewayMock.gateway,
}))

describe('ConnectionStatusBar', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    gatewayMock.listeners.connection = null
    gatewayMock.listeners.floodWait = null
    gatewayMock.gateway.connectionState = 'connected'
    gatewayMock.gateway.canManualReconnect.mockReturnValue(true)
    gatewayMock.gateway.manualReconnect.mockResolvedValue(true)
    setActivePinia(createPinia())

    const accountsStore = useAccountsStore()
    accountsStore.accounts = [
      {
        id: 'account-a',
        type: 'user',
        label: 'Alice',
        firstName: 'Alice',
        sessionString: 'session',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]
    accountsStore.activeAccountId = 'account-a'
    accountsStore.markAccountSessionReady('account-a')
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  function mountBar(): VueWrapper {
    wrapper = mount(ConnectionStatusBar, { global: { plugins: [i18n] } })
    return wrapper
  }

  it('follows connection changes and disappears again after reconnecting', async () => {
    const bar = mountBar()
    expect(bar.find('section').exists()).toBe(false)

    gatewayMock.listeners.connection?.('reconnecting')
    await nextTick()
    expect(bar.text()).toContain('Connection interrupted. Reconnecting Alice')

    gatewayMock.listeners.connection?.('connected')
    await nextTick()
    expect(bar.find('section').exists()).toBe(false)
  })

  it('shows the Telegram wait countdown immediately', async () => {
    const bar = mountBar()

    gatewayMock.listeners.floodWait?.(4, 'messages.Search')
    await nextTick()

    expect(bar.text()).toContain('Telegram is limiting requests. Continuing in 4s.')
    expect(bar.get('section').attributes('role')).toBe('status')
  })

  it('offers a manual retry after a connection failure', async () => {
    gatewayMock.gateway.connectionState = 'error'
    const bar = mountBar()

    expect(bar.text()).toContain('Could not connect Alice')
    expect(bar.get('section').attributes('role')).toBe('alert')

    await bar.get('button').trigger('click')
    expect(gatewayMock.gateway.manualReconnect).toHaveBeenCalledOnce()
  })
})
