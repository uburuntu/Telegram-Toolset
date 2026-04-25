import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'

const mockAccountsStore = {
  activeAccountId: 'account-1',
  apiCredentials: null,
  accounts: [],
  findBotByTelegramId: vi.fn(),
  setApiCredentials: vi.fn(),
  addAccount: vi.fn(),
  setActiveAccount: vi.fn(),
  updateAccount: vi.fn(),
  markAccountSessionReady: vi.fn(),
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
    abortCurrentUserAuth: vi.fn(),
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
import { telegramService } from '@/services/telegram/client'

describe('LoginModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccountsStore.apiCredentials = null
    mockAccountsStore.accounts = []
  })

  afterEach(() => {
    vi.useRealTimers()
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
    const service = telegramService as any
    service.abortCurrentUserAuth.mockResolvedValue(undefined)

    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('button[aria-label="Close"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(service.abortCurrentUserAuth).toHaveBeenCalledTimes(1)
    expect(mockUiStore.closeModal).not.toHaveBeenCalled()
  })

  it('enters the code step without showing a stuck verifying state', async () => {
    mockAccountsStore.apiCredentials = {
      apiId: 123456,
      apiHash: '0123456789abcdef',
    }
    mockAccountsStore.accounts = [
      {
        id: 'account-1',
        type: 'user',
        label: 'Ramzan',
        firstName: 'Ramzan',
        phone: '+79261247596',
        sessionString: 'expired-session',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]

    const service = telegramService as any
    service.resetForNewUserLogin.mockResolvedValue(undefined)
    service.initClient.mockResolvedValue(undefined)
    service.startUserAuth.mockImplementation(
      (
        _phone: string,
        options?: {
          onCodeNeeded?: () => void
        },
      ) => {
        options?.onCodeNeeded?.()
        return new Promise(() => {})
      },
    )

    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user', replaceAccountId: 'account-1' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('Verification Code')
    const submitButton = wrapper.get('button[type="submit"]')
    expect(submitButton.text()).toBe('Verify')
    expect(submitButton.attributes('disabled')).toBeUndefined()
  })

  it('submits the verification code and completes re-login', async () => {
    mockAccountsStore.apiCredentials = {
      apiId: 123456,
      apiHash: '0123456789abcdef',
    }
    mockAccountsStore.accounts = [
      {
        id: 'account-1',
        type: 'user',
        label: 'Ramzan',
        firstName: 'Ramzan',
        phone: '+79261247596',
        sessionString: 'expired-session',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]

    const service = telegramService as any
    let resolveAuth!: (user: { firstName: string; username: string }) => void
    const authPromise = new Promise<{ firstName: string; username: string }>((resolve) => {
      resolveAuth = resolve
    })

    service.resetForNewUserLogin.mockResolvedValue(undefined)
    service.initClient.mockResolvedValue(undefined)
    service.startUserAuth.mockImplementation(
      (
        _phone: string,
        options?: {
          onCodeNeeded?: () => void
        },
      ) => {
        options?.onCodeNeeded?.()
        return authPromise
      },
    )
    service.provideCode.mockImplementation((submittedCode: string) => {
      expect(submittedCode).toBe('12345')
      resolveAuth({ firstName: 'Ramzan', username: 'ramzan' })
      return true
    })
    service.getSessionString.mockReturnValue('fresh-session')

    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user', replaceAccountId: 'account-1' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    await wrapper.get('input[inputmode="numeric"]').setValue('12345')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(service.provideCode).toHaveBeenCalledTimes(1)
    expect(mockAccountsStore.updateAccount).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        firstName: 'Ramzan',
        username: 'ramzan',
        phone: '+79261247596',
        sessionString: 'fresh-session',
      }),
    )
    expect(mockAccountsStore.markAccountSessionReady).toHaveBeenCalledWith('account-1')
    expect(mockAccountsStore.setActiveAccount).toHaveBeenCalledWith('account-1')
  })

  it('keeps the verification code flow alive after a recoverable code error', async () => {
    mockAccountsStore.apiCredentials = {
      apiId: 123456,
      apiHash: '0123456789abcdef',
    }
    mockAccountsStore.accounts = [
      {
        id: 'account-1',
        type: 'user',
        label: 'Ramzan',
        firstName: 'Ramzan',
        phone: '+79261247596',
        sessionString: 'expired-session',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]

    const service = telegramService as any
    let authOptions:
      | {
          onCodeNeeded?: () => void
          onRecoverableError?: (error: unknown, stage: 'code' | 'password') => void
        }
      | undefined
    let resolveAuth!: (user: { firstName: string; username: string }) => void
    const authPromise = new Promise<{ firstName: string; username: string }>((resolve) => {
      resolveAuth = resolve
    })
    let codeAttempts = 0

    service.resetForNewUserLogin.mockResolvedValue(undefined)
    service.initClient.mockResolvedValue(undefined)
    service.startUserAuth.mockImplementation((_phone: string, options: typeof authOptions) => {
      authOptions = options
      options?.onCodeNeeded?.()
      return authPromise
    })
    service.provideCode.mockImplementation(() => {
      codeAttempts += 1
      if (codeAttempts === 1) {
        authOptions?.onRecoverableError?.(new Error('PHONE_CODE_INVALID'), 'code')
        authOptions?.onCodeNeeded?.()
        return true
      }

      resolveAuth({ firstName: 'Ramzan', username: 'ramzan' })
      return true
    })
    service.getSessionString.mockReturnValue('fresh-session')

    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user', replaceAccountId: 'account-1' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    await wrapper.get('input[inputmode="numeric"]').setValue('11111')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('PHONE_CODE_INVALID')
    expect((wrapper.get('input[inputmode="numeric"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('input[inputmode="numeric"]').setValue('22222')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(service.provideCode).toHaveBeenCalledTimes(2)
    expect(mockAccountsStore.updateAccount).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        firstName: 'Ramzan',
        username: 'ramzan',
        phone: '+79261247596',
        sessionString: 'fresh-session',
      }),
    )
    expect(mockAccountsStore.markAccountSessionReady).toHaveBeenCalledWith('account-1')
    expect(mockAccountsStore.setActiveAccount).toHaveBeenCalledWith('account-1')
  })

  it('keeps the re-login password flow alive after a recoverable 2FA error', async () => {
    vi.useFakeTimers()

    mockAccountsStore.apiCredentials = {
      apiId: 123456,
      apiHash: '0123456789abcdef',
    }
    mockAccountsStore.accounts = [
      {
        id: 'account-1',
        type: 'user',
        label: 'Ramzan',
        firstName: 'Ramzan',
        phone: '+79261247596',
        sessionString: 'expired-session',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]

    const service = telegramService as any
    let authOptions:
      | {
          onPasswordNeeded?: (hint?: string) => void
          onRecoverableError?: (error: unknown, stage: 'code' | 'password') => void
        }
      | undefined
    let resolveAuth!: (user: { firstName: string; username: string }) => void
    const authPromise = new Promise<{ firstName: string; username: string }>((resolve) => {
      resolveAuth = resolve
    })
    let passwordAttempts = 0

    service.resetForNewUserLogin.mockResolvedValue(undefined)
    service.initClient.mockResolvedValue(undefined)
    service.startUserAuth.mockImplementation((_phone: string, options: typeof authOptions) => {
      authOptions = options
      options?.onCodeNeeded?.()
      return authPromise
    })
    service.provideCode.mockImplementation(() => {
      authOptions?.onPasswordNeeded?.('mambo')
      return true
    })
    service.providePassword.mockImplementation(() => {
      passwordAttempts += 1
      if (passwordAttempts === 1) {
        authOptions?.onRecoverableError?.(new Error('Incorrect password'), 'password')
        authOptions?.onPasswordNeeded?.('mambo')
        return true
      }

      resolveAuth({ firstName: 'Ramzan', username: 'ramzan' })
      return true
    })
    service.getSessionString.mockReturnValue('fresh-session')

    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user', replaceAccountId: 'account-1' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    await wrapper.get('input[type="text"]').setValue('12345')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('2FA Password')

    await wrapper.get('input[type="password"]').setValue('wrong-password')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('Incorrect password')
    expect(service.providePassword).toHaveBeenCalledTimes(1)

    await wrapper.get('input[type="password"]').setValue('correct-password')
    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(mockAccountsStore.updateAccount).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        firstName: 'Ramzan',
        username: 'ramzan',
        phone: '+79261247596',
        sessionString: 'fresh-session',
      }),
    )
    expect(mockAccountsStore.markAccountSessionReady).toHaveBeenCalledWith('account-1')
    expect(mockAccountsStore.setActiveAccount).toHaveBeenCalledWith('account-1')

    vi.runAllTimers()
  })
})
