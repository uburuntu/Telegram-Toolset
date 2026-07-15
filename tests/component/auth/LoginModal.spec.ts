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
    beginActiveAccountTransition: vi.fn(() => 1),
    completeActiveAccountTransition: vi.fn(),
    markActiveUserSession: vi.fn(),
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
import { getBotInfo, isValidTokenFormat, maskBotToken } from '@/services/telegram/bot-api'
import { telegramService } from '@/services/telegram/client'

describe('LoginModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccountsStore.apiCredentials = null
    mockAccountsStore.accounts = []
    vi.mocked(telegramService.abortCurrentUserAuth).mockResolvedValue(undefined)
    vi.mocked(telegramService.beginActiveAccountTransition).mockReturnValue(1)
    vi.mocked(isValidTokenFormat).mockImplementation((token: string) =>
      /^\d+:[A-Za-z0-9_-]{20,}$/.test(token),
    )
    vi.mocked(maskBotToken).mockImplementation((value: string) => value)
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

  it('moves focus into the first field when opened', async () => {
    const wrapper = mount(LoginModal, {
      attachTo: document.body,
      props: { requiredType: 'user' },
      global: {
        plugins: [i18n],
      },
    })

    await flushPromises()

    expect(document.activeElement).toBe(wrapper.get('#login-modal-api-id').element)

    wrapper.unmount()
  })

  it('traps keyboard focus inside the dialog', async () => {
    const wrapper = mount(LoginModal, {
      attachTo: document.body,
      props: { requiredType: 'user' },
      global: {
        plugins: [i18n],
      },
    })

    const dialog = wrapper.get('[role="dialog"]')
    const closeButton = wrapper.get('button[aria-label="Close"]')
    const submitButton = wrapper.get('button[type="submit"]')
    const focusClose = vi.spyOn(closeButton.element as HTMLButtonElement, 'focus')
    const focusSubmit = vi.spyOn(submitButton.element as HTMLButtonElement, 'focus')

    ;(submitButton.element as HTMLButtonElement).focus()
    await submitButton.trigger('keydown', { key: 'Tab' })
    expect(focusClose).toHaveBeenCalled()

    focusSubmit.mockClear()
    ;(closeButton.element as HTMLButtonElement).focus()
    await closeButton.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(focusSubmit).toHaveBeenCalled()

    focusClose.mockRestore()
    focusSubmit.mockRestore()

    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const service = telegramService as any
    service.abortCurrentUserAuth.mockResolvedValue(undefined)

    const wrapper = mount(LoginModal, {
      attachTo: document.body,
      props: { requiredType: 'user' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(service.abortCurrentUserAuth).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('associates validation errors with the current field', async () => {
    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    const apiIdInput = wrapper.get('#login-modal-api-id')
    const apiIdLabel = wrapper.get(`label[for="${apiIdInput.attributes('id')}"]`)
    const errorMessage = wrapper.get('#login-modal-credentials-error')

    expect(apiIdLabel.text()).toBe('API ID')
    expect(apiIdInput.attributes('aria-invalid')).toBe('true')
    expect(apiIdInput.attributes('aria-errormessage')).toBe('login-modal-credentials-error')
    expect(errorMessage.attributes('role')).toBe('alert')
  })

  it('masks API hashes and bot tokens at the input boundary', async () => {
    const userWrapper = mount(LoginModal, {
      props: { requiredType: 'user' },
      global: {
        plugins: [i18n],
      },
    })
    expect(userWrapper.get('#login-modal-api-hash').attributes('type')).toBe('password')

    const botWrapper = mount(LoginModal, {
      props: { requiredType: 'bot' },
      global: {
        plugins: [i18n],
      },
    })
    expect(botWrapper.get('#login-modal-bot-token').attributes('type')).toBe('password')
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

  it('reports account persistence failures after Telegram authentication completes', async () => {
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
    service.startUserAuth.mockResolvedValue({
      id: BigInt(123),
      firstName: 'Ramzan',
      username: 'ramzan',
      phone: '+79261247596',
    })
    service.getSessionString.mockReturnValue('fresh-session')
    mockAccountsStore.updateAccount.mockRejectedValueOnce(new Error('Failed to save account'))

    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user', replaceAccountId: 'account-1' },
      global: {
        plugins: [i18n],
      },
    })

    const phoneInput = wrapper.get('#login-modal-phone')
    expect(phoneInput.attributes('readonly')).toBeDefined()

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to save account')
    expect(wrapper.get('#login-modal-phone').exists()).toBe(true)
    expect(mockAccountsStore.markAccountSessionReady).not.toHaveBeenCalled()
    expect(mockAccountsStore.setActiveAccount).not.toHaveBeenCalled()
  })

  it('allows re-login to restore a missing stored phone number', () => {
    mockAccountsStore.apiCredentials = {
      apiId: 123456,
      apiHash: '0123456789abcdef',
    }
    mockAccountsStore.accounts = [
      {
        id: 'account-1',
        type: 'user',
        label: 'Ramzan',
        sessionString: 'expired-session',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]

    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user', replaceAccountId: 'account-1' },
      global: {
        plugins: [i18n],
      },
    })

    expect(wrapper.get('#login-modal-phone').attributes('readonly')).toBeUndefined()
  })

  it('does not activate an account when unmounted during persistence', async () => {
    mockAccountsStore.apiCredentials = {
      apiId: 123456,
      apiHash: '0123456789abcdef',
    }
    mockAccountsStore.accounts = [
      {
        id: 'account-1',
        type: 'user',
        label: 'Ramzan',
        phone: '+79261247596',
        sessionString: 'expired-session',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]

    const service = telegramService as any
    service.resetForNewUserLogin.mockResolvedValue(undefined)
    service.initClient.mockResolvedValue(undefined)
    service.startUserAuth.mockResolvedValue({
      id: BigInt(123),
      firstName: 'Ramzan',
      username: 'ramzan',
      phone: '+79261247596',
    })
    service.getSessionString.mockReturnValue('fresh-session')

    let resolvePersistence!: () => void
    mockAccountsStore.updateAccount.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePersistence = resolve
        }),
    )

    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user', replaceAccountId: 'account-1' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(mockAccountsStore.updateAccount).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    resolvePersistence()
    await flushPromises()

    expect(mockAccountsStore.markAccountSessionReady).not.toHaveBeenCalled()
    expect(mockAccountsStore.setActiveAccount).not.toHaveBeenCalled()
  })

  it('does not start authentication after closing during client reset', async () => {
    mockAccountsStore.apiCredentials = {
      apiId: 123456,
      apiHash: '0123456789abcdef',
    }
    mockAccountsStore.accounts = [
      {
        id: 'account-1',
        type: 'user',
        label: 'Ramzan',
        phone: '+79261247596',
        sessionString: 'expired-session',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lastUsedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]

    const service = telegramService as any
    let finishReset!: () => void
    service.resetForNewUserLogin.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishReset = resolve
        }),
    )
    service.abortCurrentUserAuth.mockResolvedValue(undefined)

    const wrapper = mount(LoginModal, {
      props: { requiredType: 'user', replaceAccountId: 'account-1' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('form').trigger('submit.prevent')
    await flushPromises()
    expect(service.resetForNewUserLogin).toHaveBeenCalledTimes(1)
    expect(service.beginActiveAccountTransition).toHaveBeenCalledTimes(1)

    await wrapper.get('button[aria-label="Close"]').trigger('click')
    await flushPromises()
    finishReset()
    await flushPromises()

    expect(service.initClient).not.toHaveBeenCalled()
    expect(service.startUserAuth).not.toHaveBeenCalled()
    expect(service.completeActiveAccountTransition).toHaveBeenCalledWith(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
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

  it('ignores stale bot validation responses', async () => {
    let resolveFirstValidation!: (value: {
      id: number
      is_bot: true
      first_name: string
      username: string
    }) => void
    let resolveSecondValidation!: (value: {
      id: number
      is_bot: true
      first_name: string
      username: string
    }) => void

    const firstValidation = new Promise<{
      id: number
      is_bot: true
      first_name: string
      username: string
    }>((resolve) => {
      resolveFirstValidation = resolve
    })
    const secondValidation = new Promise<{
      id: number
      is_bot: true
      first_name: string
      username: string
    }>((resolve) => {
      resolveSecondValidation = resolve
    })

    vi.mocked(getBotInfo)
      .mockImplementationOnce(() => firstValidation)
      .mockImplementationOnce(() => secondValidation)

    const wrapper = mount(LoginModal, {
      props: { requiredType: 'any' },
      global: {
        plugins: [i18n],
      },
    })

    await wrapper.get('[data-testid="tab-bot"]').trigger('click')

    const botTokenInput = wrapper.get('#login-modal-bot-token')
    await botTokenInput.setValue('123456:AAAAAAAAAAAAAAAAAAAAAA')
    await botTokenInput.setValue('654321:BBBBBBBBBBBBBBBBBBBBBB')

    resolveSecondValidation({
      id: 654321,
      is_bot: true,
      first_name: 'Second Bot',
      username: 'second_bot',
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Second Bot')
    expect(wrapper.text()).not.toContain('Failed to validate bot token')

    resolveFirstValidation({
      id: 123456,
      is_bot: true,
      first_name: 'First Bot',
      username: 'first_bot',
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Second Bot')
    expect(wrapper.text()).not.toContain('First Bot')
  })
})
