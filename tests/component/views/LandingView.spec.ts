import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { contributeCard, modules } from '@/modules'
import { useAccountsStore, useUiStore } from '@/stores'
import type { SavedAccount } from '@/types'
import LandingView from '@/views/LandingView.vue'

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}))

function createUserAccount(overrides: Partial<SavedAccount> = {}): SavedAccount {
  return {
    id: 'user-1',
    type: 'user',
    label: 'Alice',
    firstName: 'Alice',
    phone: '+1234567890',
    sessionString: 'session',
    createdAt: new Date('2024-03-10T12:00:00Z'),
    lastUsedAt: new Date('2024-03-10T12:00:00Z'),
    ...overrides,
  }
}

function createBotAccount(overrides: Partial<SavedAccount> = {}): SavedAccount {
  return {
    id: 'bot-1',
    type: 'bot',
    label: 'MyBot',
    botToken: '123:abc',
    sessionString: '',
    createdAt: new Date('2024-03-10T12:00:00Z'),
    lastUsedAt: new Date('2024-03-10T12:00:00Z'),
    ...overrides,
  }
}

function mountView() {
  return mount(LandingView, {
    global: {
      plugins: [i18n],
    },
  })
}

function moduleButton(wrapper: ReturnType<typeof mountView>, moduleId: string) {
  const name = i18n.global.t(`modules.${moduleId}.name`)
  return wrapper.findAll('button').find((button) => button.text().includes(name))
}

describe('LandingView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('renders a button per module plus the contribute card', () => {
    const wrapper = mountView()

    expect(wrapper.findAll('button')).toHaveLength(modules.length)
    expect(wrapper.get('a[href]').attributes('href')).toBe(contributeCard.url)
  })

  it('shows the welcome banner when no account is connected', () => {
    const wrapper = mountView()

    expect(wrapper.text()).toContain(i18n.global.t('landing.welcome'))
  })

  it('shows the active account instead of the welcome banner', () => {
    const accounts = useAccountsStore()
    accounts.accounts = [createUserAccount()]
    accounts.activeAccountId = 'user-1'

    const wrapper = mountView()

    expect(wrapper.text()).toContain('Alice')
    expect(wrapper.text()).not.toContain(i18n.global.t('landing.welcome'))
  })

  it('navigates directly when the active account is already compatible', async () => {
    const accounts = useAccountsStore()
    accounts.accounts = [createUserAccount()]
    accounts.activeAccountId = 'user-1'

    const wrapper = mountView()
    await moduleButton(wrapper, 'exportDeleted')!.trigger('click')

    expect(pushMock).toHaveBeenCalledWith('/export')
  })

  it('auto-switches to a compatible account before navigating', async () => {
    const accounts = useAccountsStore()
    accounts.accounts = [createBotAccount(), createUserAccount()]
    accounts.activeAccountId = 'bot-1'
    const setActiveSpy = vi.spyOn(accounts, 'setActiveAccount')

    const wrapper = mountView()
    await moduleButton(wrapper, 'resend')!.trigger('click')

    expect(setActiveSpy).toHaveBeenCalledWith('user-1')
    expect(pushMock).toHaveBeenCalledWith('/resend')
  })

  it('opens the login modal when no compatible account exists', async () => {
    const accounts = useAccountsStore()
    accounts.accounts = [createBotAccount()]
    accounts.activeAccountId = 'bot-1'
    const ui = useUiStore()
    const openModalSpy = vi.spyOn(ui, 'openModal')

    const wrapper = mountView()
    await moduleButton(wrapper, 'resend')!.trigger('click')

    expect(openModalSpy).toHaveBeenCalledWith('LoginModal', {
      requiredType: 'user',
      targetRoute: '/resend',
    })
    expect(pushMock).not.toHaveBeenCalled()
  })
})
