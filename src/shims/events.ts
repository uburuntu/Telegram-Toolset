/**
 * Browser shim for Node.js 'events' module.
 *
 * GramJS dependencies (like socks) may import EventEmitter.
 * In the browser, we provide a minimal implementation.
 */

class EventEmitter {
  private _events: Map<string, Set<(...args: unknown[]) => void>> = new Map()

  on(event: string, listener: (...args: unknown[]) => void): this {
    if (!this._events.has(event)) {
      this._events.set(event, new Set())
    }
    this._events.get(event)!.add(listener)
    return this
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const wrapper = (...args: unknown[]) => {
      this.off(event, wrapper)
      listener.apply(this, args)
    }
    return this.on(event, wrapper)
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    const listeners = this._events.get(event)
    if (listeners) {
      listeners.delete(listener)
    }
    return this
  }

  removeListener(event: string, listener: (...args: unknown[]) => void): this {
    return this.off(event, listener)
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this._events.delete(event)
    } else {
      this._events.clear()
    }
    return this
  }

  emit(event: string, ...args: unknown[]): boolean {
    const listeners = this._events.get(event)
    if (!listeners || listeners.size === 0) {
      return false
    }
    listeners.forEach((listener) => {
      try {
        listener.apply(this, args)
      } catch (err) {
        console.error('EventEmitter error:', err)
      }
    })
    return true
  }

  addListener(event: string, listener: (...args: unknown[]) => void): this {
    return this.on(event, listener)
  }

  listenerCount(event: string): number {
    return this._events.get(event)?.size ?? 0
  }

  listeners(event: string): ((...args: unknown[]) => void)[] {
    return Array.from(this._events.get(event) ?? [])
  }

  prependListener(event: string, listener: (...args: unknown[]) => void): this {
    // In browser, we just add normally (order doesn't matter much)
    return this.on(event, listener)
  }

  prependOnceListener(event: string, listener: (...args: unknown[]) => void): this {
    return this.once(event, listener)
  }

  eventNames(): string[] {
    return Array.from(this._events.keys())
  }

  setMaxListeners(_n: number): this {
    // No-op in browser
    return this
  }

  getMaxListeners(): number {
    return Infinity
  }
}

export { EventEmitter }
export default EventEmitter

