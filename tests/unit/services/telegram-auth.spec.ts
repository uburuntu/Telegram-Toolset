import { tl } from '@mtcute/web'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mtcuteMethods = vi.hoisted(() => ({
  checkPassword: vi.fn(),
  deleteMessagesById: vi.fn(),
  deleteScheduledMessages: vi.fn(),
  downloadAsBuffer: vi.fn(),
  forwardMessagesById: vi.fn(),
  getAllScheduledMessages: vi.fn(),
  getChat: vi.fn(),
  getChatEventLog: vi.fn(),
  getFullUser: vi.fn(),
  getHistory: vi.fn(),
  getMe: vi.fn(),
  getMessages: vi.fn(),
  getPasswordHint: vi.fn(),
  getUsers: vi.fn(),
  iterDialogs: vi.fn(),
  iterHistory: vi.fn(),
  logOut: vi.fn(),
  resolvePeer: vi.fn(),
  searchMessages: vi.fn(),
  sendCode: vi.fn(),
  sendMedia: vi.fn(),
  sendText: vi.fn(),
  signIn: vi.fn(),
  signInBot: vi.fn(),
}))

vi.mock('@mtcute/web/methods.js', () => mtcuteMethods)

import { TelegramService } from '@/services/telegram/client'

describe('TelegramService auth flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('re-prompts for a verification code after a recoverable code error', async () => {
    const service = new TelegramService() as any
    service.client = {
      exportSession: vi.fn().mockResolvedValue('mtcute-session'),
    }
    mtcuteMethods.sendCode.mockResolvedValue({ phoneCodeHash: 'code-hash' })
    mtcuteMethods.signIn
      .mockRejectedValueOnce(new tl.RpcError(400, 'PHONE_CODE_INVALID'))
      .mockResolvedValueOnce({
        id: 42,
        firstName: 'Auth',
        lastName: 'Tester',
        username: 'auth_tester',
        phoneNumber: null,
      })

    const onCodeNeeded = vi.fn()
    const onRecoverableError = vi.fn()
    const authPromise = service.startUserAuth('+441234567890', {
      onCodeNeeded,
      onRecoverableError,
    })

    await vi.waitFor(() => expect(onCodeNeeded).toHaveBeenCalledTimes(1))
    expect(service.provideCode('11111')).toBe(true)

    await vi.waitFor(() => {
      expect(onRecoverableError).toHaveBeenCalledWith(expect.any(Error), 'code')
      expect(onCodeNeeded).toHaveBeenCalledTimes(2)
    })
    expect(service.provideCode('22222')).toBe(true)

    await expect(authPromise).resolves.toEqual({
      id: BigInt(42),
      firstName: 'Auth',
      lastName: 'Tester',
      username: 'auth_tester',
      phone: undefined,
    })
    expect(mtcuteMethods.signIn).toHaveBeenNthCalledWith(
      2,
      service.client,
      expect.objectContaining({ phoneCode: '22222', phoneCodeHash: 'code-hash' }),
    )
    expect(service.getSessionString()).toBe('mtcute-session')
  })
})
