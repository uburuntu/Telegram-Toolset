import { describe, expect, it, vi } from 'vitest'
import type { BaseTelegramClient } from '@mtcute/web'
import {
  createMtcuteClientOptions,
  importSavedSession,
} from '@/services/telegram/mtcute-runtime'

describe('mtcute runtime', () => {
  it('uses bounded connection pools and retry middleware', () => {
    const options = createMtcuteClientOptions(123, 'hash')
    const connectionCount = options.network?.connectionCount

    expect(options.disableUpdates).toBe(true)
    expect(connectionCount?.('main', 2, false)).toBe(0)
    expect(connectionCount?.('upload', 2, false)).toBe(2)
    expect(connectionCount?.('download', 2, false)).toBe(3)
    expect(connectionCount?.('downloadSmall', 2, false)).toBe(2)
    expect(options.network?.middlewares).toHaveLength(4)
  })

  it('does not touch storage for an empty saved session', async () => {
    const client = { importSession: vi.fn() } as unknown as BaseTelegramClient

    await expect(importSavedSession(client, '')).resolves.toBe('empty')
    expect(client.importSession).not.toHaveBeenCalled()
  })

  it('surfaces flood waits that exceed the internal sleep threshold', async () => {
    const onFloodWait = vi.fn()
    const options = createMtcuteClientOptions(123, 'hash', { onFloodWait })
    const observer = options.network?.middlewares?.[0]
    if (!observer) throw new Error('Flood observer is missing')

    await observer(
      { request: { _: 'messages.search' } } as never,
      vi.fn().mockResolvedValue({
        _: 'mt_rpc_error',
        errorCode: 420,
        errorMessage: 'FLOOD_WAIT_300',
      }),
    )

    expect(onFloodWait).toHaveBeenCalledWith(300, 'messages.search')
  })
})
