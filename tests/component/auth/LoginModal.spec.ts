import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'

const mockAccountsStore = {
  activeAccountId: 'account-1',
  apiCredentials: null,
  accounts: [],
  findBotByTelegramId: vi.fn(),
  setAuthFlowApiCredentials: vi.fn(),
  setApiCredentials: vi.fn(),
  addAccount: vi.fn(),
  setActiveAccount: vi.fn(),
  updateAccount: vi.fn(),
  resetAuthFlow: vi.fn(),
}

const mockUiStore = {
  closeModal: vi.fn(),
  showToast: vi.fn(),
}

vi.mock('@/stores', () => ({
  useAccountsStore: () => mockAccountsStore,
  useUiStore: () => mockUiStore,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

vi.mock('@/services/telegram/client', () => ({
  telegramService: {
    disconnect: vi.fn(),
    restoreSession: vi.fn(),
    initClient: vi.fn(),
    startUserAuth: vi.fn(),
    provideCode: vi.fn(),
    providePassword: vi.fn(),
    getSessionString: vi.fn(),
    resetForNewUserLogin: vi.fn(),
    useUserAccountSession: vi.fn(),
  },
}))

vi.mock('@/services/telegram/bot-api', () => ({
  getBotInfo: vi.fn(),
  isValidTokenFormat: vi.fn(() => false),
  maskBotToken: vi.fn((value: string) => value),
}))

import LoginModal from '@/components/auth/LoginModal.vue'

describe('LoginModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccountsStore.apiCredentials = null
    mockAccountsStore.accounts = []
  })

  it('renders with dialog semantics', () => {
    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user' },
      global: {
        plugins: [i18n],
      },
    })

    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('login-modal-title')
  })

  it('emits close without directly popping the modal store', async () => {
    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('button[aria-label="Close"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(mockAccountsStore.resetAuthFlow).toHaveBeenCalledTimes(1)
    expect(mockUiStore.closeModal).not.toHaveBeenCalled()
  })
})
