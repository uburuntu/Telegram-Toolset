import type { ApiCredentials } from '@/types/account'
import {
  clearSecureVaultSecrets,
  countSecureVaultSecrets,
  deleteSecureVaultSecret,
  getSecureVaultKey,
  getSecureVaultSecret,
  putSecureVaultKey,
  putSecureVaultSecret,
} from './indexed-db'

const MASTER_KEY_ID = 'accounts-master-key'
const API_CREDENTIALS_SECRET_ID = 'api-credentials'
const ACCOUNT_SECRET_PREFIX = 'account:'
const PAYLOAD_VERSION = 1

const encoder = new TextEncoder()
const decoder = new TextDecoder()

let vaultKeyPromise: Promise<CryptoKey> | null = null

export interface PersistedAccountSecret {
  sessionString?: string
  botToken?: string
}

/**
 * Thrown when a decrypt is attempted but the vault master key does not exist. Read paths never mint a
 * new key: doing so would silently strand every existing secret under a fresh, wrong key
 * (ARCHITECTURE.md §6). Callers treat this like any other unreadable-secret error and degrade the
 * affected record instead of failing the whole load.
 */
export class VaultKeyUnavailableError extends Error {
  constructor() {
    super('Secure vault master key is unavailable.')
    this.name = 'VaultKeyUnavailableError'
  }
}

const VAULT_KEY_LOCK = 'telegram-toolset:vault-master-key'

function getWebCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure storage requires WebCrypto support.')
  }

  return globalThis.crypto
}

/**
 * Run first-use key creation under a cross-tab Web Lock where available, so two tabs cannot mint
 * incompatible master keys and strand each other's secrets (ARCHITECTURE.md §6). When the Web Locks
 * API is unavailable the caller falls back to an add-if-absent winner read inside the critical section.
 */
async function withVaultKeyLock<T>(critical: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  if (!locks?.request) {
    return critical()
  }

  return locks.request(VAULT_KEY_LOCK, () => critical()) as Promise<T>
}

async function createVaultKey(): Promise<CryptoKey> {
  const cryptoApi = getWebCrypto()

  return cryptoApi.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Resolve the vault master key. When it is missing:
 * - read paths (`createIfMissing: false`) throw {@link VaultKeyUnavailableError} rather than creating
 *   a key, so existing (now-unreadable) secrets are never silently orphaned under a new key;
 * - write paths (`createIfMissing: true`) first clear any orphaned secrets that can no longer be
 *   decrypted, then create a fresh key. Clearing is explicit and logged, not silent.
 */
async function resolveVaultKey(createIfMissing: boolean): Promise<CryptoKey> {
  const existingKey = await getSecureVaultKey(MASTER_KEY_ID)
  if (existingKey) {
    return existingKey
  }

  if (!createIfMissing) {
    throw new VaultKeyUnavailableError()
  }

  return withVaultKeyLock(async () => {
    // Re-read inside the lock: another tab may have created the key while we waited for it. This is
    // the add-if-absent winner read that prevents a second incompatible key from being minted.
    const winner = await getSecureVaultKey(MASTER_KEY_ID)
    if (winner) {
      return winner
    }

    const orphanCount = await countSecureVaultSecrets()
    if (orphanCount > 0) {
      console.error(
        `Secure vault master key is missing while ${orphanCount} secret(s) exist; clearing the unreadable secrets before creating a new key.`,
      )
      await clearSecureVaultSecrets()
    }

    const nextKey = await createVaultKey()
    await putSecureVaultKey(MASTER_KEY_ID, nextKey)
    return nextKey
  })
}

function getVaultKey(createIfMissing = true): Promise<CryptoKey> {
  if (!vaultKeyPromise) {
    const pending = resolveVaultKey(createIfMissing)
    // Only cache a key that actually resolves; drop the cache on failure so a later call (e.g. a
    // write after failed reads) can retry and, if appropriate, create the key.
    pending.catch(() => {
      if (vaultKeyPromise === pending) {
        vaultKeyPromise = null
      }
    })
    vaultKeyPromise = pending
  }

  return vaultKeyPromise
}

function additionalData(id: string): Uint8Array {
  return encoder.encode(id)
}

async function encryptValue<T>(
  id: string,
  value: T,
): Promise<{ iv: Uint8Array; ciphertext: ArrayBuffer }> {
  const cryptoApi = getWebCrypto()
  const key = await getVaultKey(true)
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  // Versioned envelope keeps room for future format changes; AAD binds the ciphertext to its record
  // id so a blob cannot be moved between vault entries and still decrypt.
  const plaintext = encoder.encode(JSON.stringify({ v: PAYLOAD_VERSION, data: value }))
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: additionalData(id) as BufferSource },
    key,
    plaintext,
  )

  return { iv, ciphertext }
}

function unwrapPayload<T>(parsed: unknown): T {
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    (parsed as { v?: unknown }).v === PAYLOAD_VERSION &&
    'data' in (parsed as Record<string, unknown>)
  ) {
    return (parsed as { data: T }).data
  }

  // Legacy records stored the raw value with no envelope.
  return parsed as T
}

async function decryptValue<T>(
  id: string,
  iv: Uint8Array,
  ciphertext: ArrayBuffer,
  validate: (value: unknown) => void,
): Promise<T> {
  const cryptoApi = getWebCrypto()
  const key = await getVaultKey(false)

  let plaintextBuffer: ArrayBuffer
  try {
    plaintextBuffer = await cryptoApi.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as BufferSource,
        additionalData: additionalData(id) as BufferSource,
      },
      key,
      ciphertext,
    )
  } catch {
    // Legacy records were written without AAD; fall back so they remain readable. A genuinely wrong
    // key or corrupt ciphertext still throws here and is handled by the caller.
    plaintextBuffer = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext,
    )
  }

  const parsed = JSON.parse(decoder.decode(plaintextBuffer))
  const value = unwrapPayload<T>(parsed)
  validate(value)
  return value
}

async function saveSecret<T>(id: string, value: T | null): Promise<void> {
  if (value === null) {
    await deleteSecureVaultSecret(id)
    return
  }

  const encrypted = await encryptValue(id, value)
  await putSecureVaultSecret({
    id,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  })
}

async function loadSecret<T>(id: string, validate: (value: unknown) => void): Promise<T | null> {
  const encrypted = await getSecureVaultSecret(id)
  if (!encrypted) {
    return null
  }

  return decryptValue<T>(id, encrypted.iv, encrypted.ciphertext, validate)
}

function assertApiCredentials(value: unknown): asserts value is ApiCredentials {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as ApiCredentials).apiId !== 'number' ||
    typeof (value as ApiCredentials).apiHash !== 'string'
  ) {
    throw new Error('Decrypted API credentials failed validation.')
  }
}

function assertAccountSecret(value: unknown): asserts value is PersistedAccountSecret {
  if (value === null || typeof value !== 'object') {
    throw new Error('Decrypted account secret failed validation.')
  }

  const secret = value as PersistedAccountSecret
  if (
    (secret.sessionString !== undefined && typeof secret.sessionString !== 'string') ||
    (secret.botToken !== undefined && typeof secret.botToken !== 'string')
  ) {
    throw new Error('Decrypted account secret failed validation.')
  }
}

function getAccountSecretId(accountId: string): string {
  return `${ACCOUNT_SECRET_PREFIX}${accountId}`
}

export async function loadSecureApiCredentials(): Promise<ApiCredentials | null> {
  return loadSecret<ApiCredentials>(API_CREDENTIALS_SECRET_ID, assertApiCredentials)
}

export async function saveSecureApiCredentials(credentials: ApiCredentials | null): Promise<void> {
  await saveSecret<ApiCredentials>(API_CREDENTIALS_SECRET_ID, credentials)
}

export async function loadSecureAccountSecret(
  accountId: string,
): Promise<PersistedAccountSecret | null> {
  return loadSecret<PersistedAccountSecret>(getAccountSecretId(accountId), assertAccountSecret)
}

export async function saveSecureAccountSecret(
  accountId: string,
  secret: PersistedAccountSecret | null,
): Promise<void> {
  await saveSecret<PersistedAccountSecret>(getAccountSecretId(accountId), secret)
}

export async function deleteSecureAccountSecret(accountId: string): Promise<void> {
  await deleteSecureVaultSecret(getAccountSecretId(accountId))
}
