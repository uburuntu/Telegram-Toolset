/**
 * Minimal browser shim for Node's `util` module.
 *
 * GramJS (telegram) references `util.inspect.custom` for pretty-print hooks.
 * In the browser, Vite doesn't polyfill Node built-ins, so `inspect` can be undefined,
 * leading to runtime crashes during module evaluation.
 *
 * We intentionally implement only what's needed by GramJS.
 */

export type InspectFn = ((value: unknown) => string) & { custom?: symbol }

export const inspect: InspectFn = ((value: unknown) => {
  try {
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}) as InspectFn

// In Node, this is a symbol used as a computed property key.
inspect.custom = Symbol.for('nodejs.util.inspect.custom')
