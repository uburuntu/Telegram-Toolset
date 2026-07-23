/**
 * Deep-unwrap Vue reactivity into a plain, structured-cloneable snapshot.
 *
 * IndexedDB stores values with the structured clone algorithm. WebKit (Safari) throws
 * `DataCloneError: The object can not be cloned.` whenever the value graph contains a `Proxy`, and
 * every Vue `reactive`/`ref` object is a Proxy. Chromium happens to clone reactive proxies, so a
 * record that originates from reactive UI/store state — e.g. a selected chat's `peerRef` or an
 * account's `principal` — persists fine in dev/CI yet fails on a real Safari client. Taking a plain
 * snapshot right before `put` removes the proxies without changing the stored shape.
 *
 * Structured-clone-safe leaves are preserved by reference: primitives (including `bigint`), `Date`,
 * `Blob`/`File`, `ArrayBuffer`, and typed arrays. Non-plain objects (class instances, `CryptoKey`,
 * `Map`, `Set`) are returned unwrapped rather than rebuilt, so we never strip a host object's
 * internal slots — only plain objects and arrays are reconstructed.
 */
import { isRef, toRaw } from 'vue'

export function toPlainSnapshot<T>(value: T): T {
  return snapshot(value) as T
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function snapshot(value: unknown): unknown {
  if (isRef(value)) {
    return snapshot(value.value)
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  if (
    value instanceof Date ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== 'undefined' && value instanceof Blob)
  ) {
    return value
  }

  const raw = toRaw(value)

  if (Array.isArray(raw)) {
    return raw.map(snapshot)
  }

  if (!isPlainObject(raw)) {
    return raw
  }

  const result: Record<string, unknown> = {}
  for (const key of Object.keys(raw)) {
    result[key] = snapshot((raw as Record<string, unknown>)[key])
  }
  return result
}
