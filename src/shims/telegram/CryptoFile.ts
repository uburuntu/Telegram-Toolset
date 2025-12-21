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
 */

import * as browserCrypto from 'telegram/crypto/crypto'

export default browserCrypto
export * from 'telegram/crypto/crypto'
