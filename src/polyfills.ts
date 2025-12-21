// Browser polyfills required by GramJS (telegram) and related deps.
// Must run before any imports that transitively import `telegram`.

import { Buffer as NodeBuffer } from 'buffer'

const g = globalThis as any

// Ensure Node-style globals exist in the browser.
if (typeof g.global === 'undefined') g.global = globalThis
if (typeof g.Buffer === 'undefined') g.Buffer = NodeBuffer
