/**
 * Browser shim for Node's `crypto` module.
 *
 * GramJS uses Node's crypto for randomBytes, createHash, etc.
 * We provide browser-compatible implementations using Web Crypto API.
 */

// Use globalThis.crypto for Web Crypto API
const webCrypto = globalThis.crypto

/**
 * Generate random bytes using Web Crypto API
 */
export function randomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count)
  webCrypto.getRandomValues(bytes)
  return bytes
}

/**
 * Hash class compatible with Node's crypto.createHash
 */
export class Hash {
  private algorithm: string
  private data?: Uint8Array

  constructor(algorithm: string) {
    this.algorithm = algorithm
  }

  update(data: Uint8Array | ArrayBuffer): this {
    if (data instanceof ArrayBuffer) {
      this.data = new Uint8Array(data)
    } else {
      // Create a copy to avoid SharedArrayBuffer issues
      this.data = new Uint8Array(data)
    }
    return this
  }

  async digest(): Promise<ArrayBuffer> {
    if (!this.data) {
      return new ArrayBuffer(0)
    }

    let algo: string
    if (this.algorithm === 'sha1') {
      algo = 'SHA-1'
    } else if (this.algorithm === 'sha256') {
      algo = 'SHA-256'
    } else if (this.algorithm === 'sha512') {
      algo = 'SHA-512'
    } else {
      throw new Error(`Unsupported hash algorithm: ${this.algorithm}`)
    }

    // Create a regular ArrayBuffer copy to satisfy Web Crypto API types
    const buffer = new ArrayBuffer(this.data.byteLength)
    new Uint8Array(buffer).set(this.data)
    return await webCrypto.subtle.digest(algo, buffer)
  }
}

/**
 * Create a hash instance
 */
export function createHash(algorithm: string): Hash {
  return new Hash(algorithm)
}

/**
 * PBKDF2 key derivation using Web Crypto API
 */
export async function pbkdf2Sync(
  password: Uint8Array | ArrayBuffer,
  salt: Uint8Array | ArrayBuffer,
  iterations: number,
  _keylen?: number,
  _digest?: string
): Promise<ArrayBuffer> {
  // Create regular ArrayBuffer copies to satisfy Web Crypto API types
  let passwordBuffer: ArrayBuffer
  if (password instanceof ArrayBuffer) {
    passwordBuffer = password
  } else {
    passwordBuffer = new ArrayBuffer(password.byteLength)
    new Uint8Array(passwordBuffer).set(new Uint8Array(password))
  }

  let saltBuffer: ArrayBuffer
  if (salt instanceof ArrayBuffer) {
    saltBuffer = salt
  } else {
    saltBuffer = new ArrayBuffer(salt.byteLength)
    new Uint8Array(saltBuffer).set(new Uint8Array(salt))
  }

  const passwordKey = await webCrypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )

  return await webCrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-512',
      salt: saltBuffer,
      iterations: iterations,
    },
    passwordKey,
    512
  )
}

/**
 * Counter for CTR mode encryption
 */
export class Counter {
  _counter: Uint8Array

  constructor(initialValue: Uint8Array | ArrayBuffer) {
    if (initialValue instanceof ArrayBuffer) {
      this._counter = new Uint8Array(initialValue)
    } else {
      // Create a copy
      this._counter = new Uint8Array(initialValue)
    }
  }

  increment(): void {
    for (let i = 15; i >= 0; i--) {
      const val = this._counter[i]
      if (val !== undefined && val === 255) {
        this._counter[i] = 0
      } else if (val !== undefined) {
        this._counter[i] = val + 1
        break
      }
    }
  }
}

/**
 * CTR mode cipher (stub - uses GramJS's own implementation when available)
 */
export class CTR {
  constructor(_key: Uint8Array | ArrayBuffer, _counter: Counter | Uint8Array | ArrayBuffer) {
    // This is a stub - GramJS uses its own CTR implementation
    throw new Error('CTR encryption should use telegram/crypto/crypto implementation')
  }

  update(_plainText: Uint8Array | ArrayBuffer): Uint8Array {
    throw new Error('CTR encryption should use telegram/crypto/crypto implementation')
  }

  encrypt(_plainText: Uint8Array | ArrayBuffer): Uint8Array {
    throw new Error('CTR encryption should use telegram/crypto/crypto implementation')
  }
}

export function createCipheriv(
  _algorithm: string,
  _key: Uint8Array | ArrayBuffer,
  _iv: Uint8Array | ArrayBuffer
): CTR {
  throw new Error('createCipheriv should use telegram/crypto/crypto implementation')
}

export function createDecipheriv(
  _algorithm: string,
  _key: Uint8Array | ArrayBuffer,
  _iv: Uint8Array | ArrayBuffer
): CTR {
  throw new Error('createDecipheriv should use telegram/crypto/crypto implementation')
}

// Create an object with all exports for default export
// This supports both `import crypto from 'crypto'` and `import { randomBytes } from 'crypto'`
const cryptoModule = {
  randomBytes,
  createHash,
  pbkdf2Sync,
  Counter,
  CTR,
  Hash,
  createCipheriv,
  createDecipheriv,
}

export default cryptoModule
