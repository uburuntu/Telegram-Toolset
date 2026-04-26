import type { ApiCredentials } from '@/types/account'
import {
  deleteSecureVaultSecret,
  getSecureVaultKey,
  getSecureVaultSecret,
  putSecureVaultKey,
  putSecureVaultSecret,
} from './indexed-db'

const MASTER_KEY_ID = 'accounts-master-key'
const API_CREDENTIALS_SECRET_ID = 'api-credentials'
const ACCOUNT_SECRET_PREFIX = 'account:'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

let vaultKeyPromise: Promise<CryptoKey> | null = null

export interface PersistedAccountSecret {
  sessionString?: string
  botToken?: string
}

function getWebCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Secure storage requires WebCrypto support.')
  }

  return globalThis.crypto
}

async function createVaultKey(): Promise<CryptoKey> {
  const cryptoApi = getWebCrypto()

  return cryptoApi.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

async function getVaultKey(): Promise<CryptoKey> {
  if (vaultKeyPromise) {
    return vaultKeyPromise
  }

  vaultKeyPromise = (async () => {
    const existingKey = await getSecureVaultKey(MASTER_KEY_ID)
    if (existingKey) {
      return existingKey
    }

    const nextKey = await createVaultKey()
    await putSecureVaultKey(MASTER_KEY_ID, nextKey)
    return nextKey
  })()

  try {
    return await vaultKeyPromise
  } catch (error) {
    vaultKeyPromise = null
    throw error
  }
}

async function encryptValue<T>(value: T): Promise<{ iv: Uint8Array; ciphertext: ArrayBuffer }> {
  const cryptoApi = getWebCrypto()
  const key = await getVaultKey()
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(value))
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext,
  )

  return { iv, ciphertext }
}

async function decryptValue<T>(iv: Uint8Array, ciphertext: ArrayBuffer): Promise<T> {
  const cryptoApi = getWebCrypto()
  const key = await getVaultKey()
  const plaintext = await cryptoApi.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext,
  )
  return JSON.parse(decoder.decode(plaintext)) as T
}

async function saveSecret<T>(id: string, value: T | null): Promise<void> {
  if (value === null) {
    await deleteSecureVaultSecret(id)
    return
  }

  const encrypted = await encryptValue(value)
  await putSecureVaultSecret({
    id,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  })
}

async function loadSecret<T>(id: string): Promise<T | null> {
  const encrypted = await getSecureVaultSecret(id)
  if (!encrypted) {
    return null
  }

  return decryptValue<T>(encrypted.iv, encrypted.ciphertext)
}

function getAccountSecretId(accountId: string): string {
  return `${ACCOUNT_SECRET_PREFIX}${accountId}`
}

export async function loadSecureApiCredentials(): Promise<ApiCredentials | null> {
  return loadSecret<ApiCredentials>(API_CREDENTIALS_SECRET_ID)
}

export async function saveSecureApiCredentials(credentials: ApiCredentials | null): Promise<void> {
  await saveSecret<ApiCredentials>(API_CREDENTIALS_SECRET_ID, credentials)
}

export async function loadSecureAccountSecret(
  accountId: string,
): Promise<PersistedAccountSecret | null> {
  return loadSecret<PersistedAccountSecret>(getAccountSecretId(accountId))
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
