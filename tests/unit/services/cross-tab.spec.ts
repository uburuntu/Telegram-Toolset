import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInvalidationChannel } from '@/services/storage/cross-tab'

/**
 * Minimal same-origin BroadcastChannel stand-in. Delivers synchronously to every *other* live
 * instance sharing the channel name, mirroring the real contract that a posting instance never
 * receives its own message.
 */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  static reset(): void {
    FakeBroadcastChannel.instances = []
  }

  onmessage: ((event: MessageEvent) => void) | null = null
  private closed = false

  constructor(public readonly name: string) {
    FakeBroadcastChannel.instances.push(this)
  }

  postMessage(data: unknown): void {
    for (const instance of FakeBroadcastChannel.instances) {
      if (instance === this || instance.closed || instance.name !== this.name) {
        continue
      }
      instance.onmessage?.({ data } as MessageEvent)
    }
  }

  close(): void {
    this.closed = true
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter((c) => c !== this)
  }
}

describe('createInvalidationChannel', () => {
  describe('without BroadcastChannel support', () => {
    beforeEach(() => {
      vi.stubGlobal('BroadcastChannel', undefined)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('returns a no-op channel that never invokes the callback or throws', () => {
      const onInvalidated = vi.fn()
      const channel = createInvalidationChannel('accounts', onInvalidated)

      expect(() => channel.post()).not.toThrow()
      expect(() => channel.close()).not.toThrow()
      expect(onInvalidated).not.toHaveBeenCalled()
    })
  })

  describe('with BroadcastChannel support', () => {
    beforeEach(() => {
      FakeBroadcastChannel.reset()
      vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      FakeBroadcastChannel.reset()
    })

    it('notifies a peer channel on the same name', () => {
      const peerInvalidated = vi.fn()
      const sender = createInvalidationChannel('accounts', vi.fn())
      createInvalidationChannel('accounts', peerInvalidated)

      sender.post()

      expect(peerInvalidated).toHaveBeenCalledTimes(1)
    })

    it('does not notify the posting instance about its own message', () => {
      const senderInvalidated = vi.fn()
      const sender = createInvalidationChannel('accounts', senderInvalidated)
      createInvalidationChannel('accounts', vi.fn())

      sender.post()

      expect(senderInvalidated).not.toHaveBeenCalled()
    })

    it('does not cross channel names', () => {
      const otherInvalidated = vi.fn()
      const sender = createInvalidationChannel('accounts', vi.fn())
      createInvalidationChannel('something-else', otherInvalidated)

      sender.post()

      expect(otherInvalidated).not.toHaveBeenCalled()
    })

    it('ignores malformed messages from the raw channel', () => {
      const onInvalidated = vi.fn()
      createInvalidationChannel('accounts', onInvalidated)

      const raw = new FakeBroadcastChannel('accounts')
      raw.postMessage({ type: 'not-an-invalidation' })
      raw.postMessage(null)
      raw.postMessage('invalidate')

      expect(onInvalidated).not.toHaveBeenCalled()
    })

    it('stops delivering after close and never throws when posting on a closed channel', () => {
      const peerInvalidated = vi.fn()
      const sender = createInvalidationChannel('accounts', vi.fn())
      const peer = createInvalidationChannel('accounts', peerInvalidated)

      peer.close()
      expect(() => sender.post()).not.toThrow()
      expect(peerInvalidated).not.toHaveBeenCalled()
    })
  })
})
