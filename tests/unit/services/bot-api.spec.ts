import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBotInfo } from '@/services/telegram/bot-api'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('getBotInfo', () => {
  it('returns the complete getMe capability result', async () => {
    const bot = {
      id: 42,
      is_bot: true,
      first_name: 'Tool Bot',
      username: 'tool_bot',
      added_to_attachment_menu: true,
      can_connect_to_business: true,
      has_main_web_app: true,
    }
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: true, result: bot }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getBotInfo('42:secret')).resolves.toEqual(bot)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('honors Bot API retry_after on a 429 response', async () => {
    vi.useFakeTimers()
    const bot = { id: 42, is_bot: true, first_name: 'Tool Bot' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests',
            parameters: { retry_after: 2 },
          },
          429,
        ),
      )
      .mockResolvedValueOnce(response({ ok: true, result: bot }))
    vi.stubGlobal('fetch', fetchMock)

    const result = getBotInfo('42:secret')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(result).resolves.toEqual(bot)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry an invalid bot token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(
        { ok: false, error_code: 401, description: 'Unauthorized' },
        401,
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(getBotInfo('42:invalid')).rejects.toThrow('Unauthorized')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
