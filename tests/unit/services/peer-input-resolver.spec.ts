import { Api } from 'telegram'
import { describe, expect, it, vi } from 'vitest'
import type { PeerRef } from '@/types'
import { resolveInputPeer } from '@/services/telegram/peer-input-resolver'

const channelWithHash: PeerRef = { kind: 'channel', rawId: '456', accessHash: '789' }
const channelNoHash: PeerRef = { kind: 'channel', rawId: '456' }

describe('resolveInputPeer', () => {
  it('resolves a raw bigint exactly as before (getEntity -> getInputEntity)', async () => {
    const entity = { id: BigInt('1') }
    const inputPeer = { marker: 'input' }
    const getEntity = vi.fn(async () => entity)
    const getInputEntity = vi.fn(async () => inputPeer)

    const result = await resolveInputPeer({ getEntity, getInputEntity }, BigInt('1'))

    expect(getEntity).toHaveBeenCalledWith(BigInt('1'))
    expect(getInputEntity).toHaveBeenCalledWith(entity)
    expect(result).toBe(inputPeer)
  })

  it('resolves a PeerRef through its marked id on the warm path, not the access hash', async () => {
    const entity = { id: BigInt('456') }
    const inputPeer = { marker: 'resolved-from-cache' }
    const getEntity = vi.fn(async () => entity)
    const getInputEntity = vi.fn(async () => inputPeer)

    const result = await resolveInputPeer({ getEntity, getInputEntity }, channelWithHash)

    // Marked id for a channel is the -100 form; the warm path must match pre-§4 behavior.
    expect(getEntity).toHaveBeenCalledWith('-100456')
    expect(result).toBe(inputPeer)
  })

  it('rebuilds from the stored access hash when the warm lookup fails (cold start)', async () => {
    const getEntity = vi.fn(async () => {
      throw new Error('Could not find the input entity for ... (empty cache)')
    })
    const getInputEntity = vi.fn()

    const result = await resolveInputPeer({ getEntity, getInputEntity }, channelWithHash)

    expect(getInputEntity).not.toHaveBeenCalled()
    expect(result).toBeInstanceOf(Api.InputPeerChannel)
    expect((result as Api.InputPeerChannel).channelId).toBe(BigInt('456'))
    expect((result as Api.InputPeerChannel).accessHash).toBe(BigInt('789'))
  })

  it('propagates the original error when a cold lookup fails and no access hash is stored', async () => {
    const coldError = new Error('not in cache')
    const getEntity = vi.fn(async () => {
      throw coldError
    })
    const getInputEntity = vi.fn()

    await expect(
      resolveInputPeer({ getEntity, getInputEntity }, channelNoHash),
    ).rejects.toBe(coldError)
  })
})
