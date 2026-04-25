import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { telegramService } from '@/services/telegram/client'

describe('telegramService auth flow', () => {
  const service = telegramService as any
  const originalClient = service.client
  const originalCurrentUser = service.currentUser
  const originalActiveUserAuthAttempt = service.activeUserAuthAttempt
  const originalUserAuthAttemptId = service.userAuthAttemptId
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    service.client = null
    service.currentUser = null
    service.activeUserAuthAttempt = null
    service.userAuthAttemptId = 0
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    service.client = originalClient
    service.currentUser = originalCurrentUser
    service.activeUserAuthAttempt = originalActiveUserAuthAttempt
    service.userAuthAttemptId = originalUserAuthAttemptId
  })

  it('re-prompts for a verification code after a recoverable code error', async () => {
    const codePrompts: string[] = []
    const startMock = vi.fn(async (authParams: any) => {
      expect(await authParams.phoneNumber()).toBe('+441234567890')

      codePrompts.push('requested')
      const firstCode = await authParams.phoneCode()
      expect(firstCode).toBe('11111')

      const invalidCodeError = Object.assign(new Error('PHONE_CODE_INVALID'), {
        errorMessage: 'PHONE_CODE_INVALID',
      })
      const shouldStop = await authParams.onError(invalidCodeError)
      expect(shouldStop).toBe(false)

      codePrompts.push('requested-again')
      const secondCode = await authParams.phoneCode()
      expect(secondCode).toBe('22222')
    })

    const getMeMock = vi.fn().mockResolvedValue({
      id: 42,
      firstName: 'Auth',
      lastName: 'Tester',
      username: 'auth_tester',
    })

    service.client = {
      start: startMock,
      getMe: getMeMock,
      disconnect: vi.fn().mockResolvedValue(undefined),
    }

    const onCodeNeeded = vi.fn()
    const onRecoverableError = vi.fn()

    const authPromise = telegramService.startUserAuth('+441234567890', {
      onCodeNeeded,
      onRecoverableError,
    })

    await vi.waitFor(() => {
      expect(onCodeNeeded).toHaveBeenCalledTimes(1)
    })

    expect(telegramService.provideCode('11111')).toBe(true)

    await vi.waitFor(() => {
      expect(onRecoverableError).toHaveBeenCalledWith(expect.any(Error), 'code')
      expect(onCodeNeeded).toHaveBeenCalledTimes(2)
    })

    expect(telegramService.provideCode('22222')).toBe(true)

    const user = await authPromise

    expect(startMock).toHaveBeenCalledTimes(1)
    expect(getMeMock).toHaveBeenCalledTimes(1)
    expect(codePrompts).toEqual(['requested', 'requested-again'])
    expect(user).toEqual({
      id: BigInt(42),
      firstName: 'Auth',
      lastName: 'Tester',
      username: 'auth_tester',
    })
  })
})
