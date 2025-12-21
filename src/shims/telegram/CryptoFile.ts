/**
 * Browser shim for GramJS' `./CryptoFile` module.
 *
 * In the published CJS build, `telegram/CryptoFile.js` re-exports Node's `crypto`,
 * but GramJS already ships a browser-friendly implementation at `telegram/crypto/crypto`.
 *
 * We re-export that implementation so callers expecting:
 * - randomBytes(count)
 * - createHash('sha1'|'sha256') with async digest()
 * - pbkdf2Sync(...) returning Promise<Buffer>
 * keep working in the browser.
 *
 * We also export as default to support `import crypto from 'crypto'` usage.
 */

import * as browserCrypto from 'telegram/crypto/crypto'

// Named exports
export const {
  randomBytes,
  createHash,
  pbkdf2Sync,
  createCipheriv,
  createDecipheriv,
  Counter,
  CTR,
  Hash,
} = browserCrypto

// Default export for `import crypto from 'crypto'` usage
export default browserCrypto
