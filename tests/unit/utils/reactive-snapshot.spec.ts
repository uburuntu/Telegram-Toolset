import { describe, expect, it } from 'vitest'
import { isProxy, isReactive, reactive, ref } from 'vue'
import { toPlainSnapshot } from '@/utils/reactive-snapshot'

/**
 * `toPlainSnapshot` exists to strip Vue reactive proxies before IndexedDB `put`, because WebKit
 * throws `DataCloneError` on any `Proxy` in the value graph. These tests assert the proxy-removal
 * property directly (the thing that fixes Safari) plus lossless preservation of clone-safe leaves.
 */
describe('toPlainSnapshot', () => {
  it('removes the reactive proxy from a top-level reactive object', () => {
    const source = reactive({ kind: 'channel', rawId: '123', accessHash: '456' })
    expect(isProxy(source)).toBe(true)

    const result = toPlainSnapshot(source)

    expect(isProxy(result)).toBe(false)
    expect(isReactive(result)).toBe(false)
    expect(result).toEqual({ kind: 'channel', rawId: '123', accessHash: '456' })
  })

  it('de-proxies a reactive value assigned onto a plain object (the chatExport.peerRef case)', () => {
    // Mirrors how a ChatExport is built: a plain literal whose `peerRef` is read out of reactive
    // UI state (a `ref<ChatInfo>`), so the record is plain but carries a nested proxy.
    const chatInfo = reactive({ peerRef: { kind: 'channel', rawId: '99', accessHash: '7' } })
    const chatExport = { id: 'export_1', chatId: 100n, peerRef: chatInfo.peerRef }
    expect(isProxy(chatExport.peerRef)).toBe(true)

    const result = toPlainSnapshot(chatExport)

    expect(isProxy(result.peerRef)).toBe(false)
    expect(result.peerRef).toEqual({ kind: 'channel', rawId: '99', accessHash: '7' })
    expect(result.chatId).toBe(100n)
  })

  it('de-proxies principals nested in a reactive account list (the account-journal case)', () => {
    const accounts = reactive([
      { id: 'a1', principal: { kind: 'user', telegramUserId: '111' } },
      { id: 'a2', principal: { kind: 'user', telegramUserId: '222' } },
    ])
    const record = { op: 'add', metadata: { accounts, activeAccountId: 'a1' } }

    const result = toPlainSnapshot(record)

    expect(isReactive(result.metadata.accounts)).toBe(false)
    expect(isProxy(result.metadata.accounts[0]!.principal)).toBe(false)
    expect(result.metadata.accounts).toEqual([
      { id: 'a1', principal: { kind: 'user', telegramUserId: '111' } },
      { id: 'a2', principal: { kind: 'user', telegramUserId: '222' } },
    ])
  })

  it('preserves primitives, including bigint', () => {
    const result = toPlainSnapshot({ n: 1, s: 'x', b: true, big: 900719925474099123n, nil: null })
    expect(result).toEqual({ n: 1, s: 'x', b: true, big: 900719925474099123n, nil: null })
    expect(typeof result.big).toBe('bigint')
  })

  it('preserves Date, Blob, ArrayBuffer, and typed arrays by identity', () => {
    const date = new Date('2026-01-02T03:04:05.000Z')
    const blob = new Blob(['hi'], { type: 'text/plain' })
    const buffer = new ArrayBuffer(8)
    const bytes = new Uint8Array([1, 2, 3])

    const result = toPlainSnapshot(reactive({ date, blob, buffer, bytes }))

    expect(result.date).toBeInstanceOf(Date)
    expect(result.date.getTime()).toBe(date.getTime())
    expect(result.blob).toBe(blob)
    expect(result.buffer).toBe(buffer)
    expect(result.bytes).toBe(bytes)
  })

  it('unwraps refs', () => {
    const result = toPlainSnapshot({ wrapped: ref('value'), list: ref([1, 2]) })
    expect(result).toEqual({ wrapped: 'value', list: [1, 2] })
  })

  it('returns non-plain objects (class instances) unwrapped rather than rebuilding them', () => {
    class Widget {
      constructor(public value: number) {}
      greet() {
        return `hi-${this.value}`
      }
    }
    const widget = new Widget(5)
    const result = toPlainSnapshot(reactive({ widget }))

    // Not rebuilt into a bare {} — the instance and its methods survive.
    expect(result.widget).toBeInstanceOf(Widget)
    expect(result.widget.greet()).toBe('hi-5')
  })

  it('produces a value the structured clone algorithm accepts', () => {
    const source = reactive({
      id: 'export_1',
      chatId: 100n,
      peerRef: { kind: 'channel', rawId: '99', accessHash: '7' },
      createdAt: new Date('2026-05-06T00:00:00.000Z'),
      messages: [{ id: 1, text: 'a', senderId: 42n }],
    })

    const plain = toPlainSnapshot(source)
    expect(() => structuredClone(plain)).not.toThrow()
    expect(structuredClone(plain)).toEqual({
      id: 'export_1',
      chatId: 100n,
      peerRef: { kind: 'channel', rawId: '99', accessHash: '7' },
      createdAt: new Date('2026-05-06T00:00:00.000Z'),
      messages: [{ id: 1, text: 'a', senderId: 42n }],
    })
  })
})
