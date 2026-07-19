import { beforeEach, describe, expect, it, vi } from 'vitest'

const openDB = vi.hoisted(() => vi.fn())

vi.mock('idb', () => ({ openDB }))

type OpenOptions = {
  blocked: (currentVersion: number, blockedVersion: number | null, event: unknown) => void
  blocking: (currentVersion: number, blockedVersion: number | null, event: unknown) => void
  terminated: () => void
}

function lastOptions(): OpenOptions {
  return openDB.mock.calls.at(-1)?.[2] as OpenOptions
}

describe('indexed-db connection resilience', () => {
  beforeEach(() => {
    vi.resetModules()
    openDB.mockReset()
  })

  it('caches one connection and reopens after termination', async () => {
    openDB.mockResolvedValue({ getAll: vi.fn().mockResolvedValue([]) })
    const db = await import('@/services/storage/indexed-db')

    await db.getAllBackups()
    await db.getAllBackups()
    // Second call reuses the cached connection.
    expect(openDB).toHaveBeenCalledTimes(1)

    // A terminated connection drops the cache so the next call reopens.
    lastOptions().terminated()
    await db.getAllBackups()
    expect(openDB).toHaveBeenCalledTimes(2)
  })

  it('closes and reopens when another tab needs to upgrade (blocking)', async () => {
    openDB.mockResolvedValue({ getAll: vi.fn().mockResolvedValue([]) })
    const db = await import('@/services/storage/indexed-db')

    await db.getAllBackups()
    expect(openDB).toHaveBeenCalledTimes(1)

    const close = vi.fn()
    lastOptions().blocking(3, 4, { target: { close } })
    // The current connection is closed so the other tab's upgrade can proceed.
    expect(close).toHaveBeenCalledTimes(1)

    await db.getAllBackups()
    expect(openDB).toHaveBeenCalledTimes(2)
  })

  it('does not poison the cache when an open attempt fails', async () => {
    openDB
      .mockRejectedValueOnce(new Error('storage denied'))
      .mockResolvedValue({ getAll: vi.fn().mockResolvedValue([]) })
    const db = await import('@/services/storage/indexed-db')

    await expect(db.getAllBackups()).rejects.toThrow('storage denied')

    // A later call retries a fresh open instead of returning the failed promise forever.
    await expect(db.getAllBackups()).resolves.toEqual([])
    expect(openDB).toHaveBeenCalledTimes(2)
  })
})
