import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('crypto', webcrypto)

const vaultStore = vi.hoisted(() => ({
  keys: new Map<string, CryptoKey>(),
  secrets: new Map<string, { id: string; iv: Uint8Array; ciphertext: ArrayBuffer }>(),
}))

vi.mock('@/services/storage/indexed-db', () => ({
  getSecureVaultKey: vi.fn(async (id: string) => vaultStore.keys.get(id)),
  putSecureVaultKey: vi.fn(async (id: string, key: CryptoKey) => {
    vaultStore.keys.set(id, key)
  }),
  getSecureVaultSecret: vi.fn(async (id: string) => vaultStore.secrets.get(id)),
  putSecureVaultSecret: vi.fn(
    async (record: { id: string; iv: Uint8Array; ciphertext: ArrayBuffer }) => {
      vaultStore.secrets.set(record.id, record)
    },
  ),
  deleteSecureVaultSecret: vi.fn(async (id: string) => {
    vaultStore.secrets.delete(id)
  }),
  countSecureVaultSecrets: vi.fn(async () => vaultStore.secrets.size),
  clearSecureVaultSecrets: vi.fn(async () => {
    vaultStore.secrets.clear()
  }),
}))

async function loadVault() {
  return import('@/services/storage/secure-account-vault')
}

const MASTER_KEY_ID = 'accounts-master-key'

describe('secure-account-vault', () => {
  beforeEach(() => {
    vaultStore.keys.clear()
    vaultStore.secrets.clear()
    vi.clearAllMocks()
    vi.resetModules()
    vi.stubGlobal('crypto', webcrypto)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips API credentials and account secrets', async () => {
    const vault = await loadVault()
    await vault.saveSecureApiCredentials({ apiId: 42, apiHash: 'hash' })
    await vault.saveSecureAccountSecret('acc-1', { sessionString: 'sess' })

    expect(await vault.loadSecureApiCredentials()).toEqual({ apiId: 42, apiHash: 'hash' })
    expect(await vault.loadSecureAccountSecret('acc-1')).toEqual({ sessionString: 'sess' })
  })

  it('binds ciphertext to its record id (AAD), rejecting a moved blob', async () => {
    const vault = await loadVault()
    await vault.saveSecureAccountSecret('acc-a', { sessionString: 'a-session' })

    // Move acc-a's encrypted blob under acc-b's record id.
    const moved = vaultStore.secrets.get('account:acc-a')
    if (!moved) {
      throw new Error('expected a stored record')
    }
    vaultStore.secrets.set('account:acc-b', { ...moved, id: 'account:acc-b' })

    await expect(vault.loadSecureAccountSecret('acc-b')).rejects.toThrow()
  })

  it('still reads legacy records written without AAD or a version envelope', async () => {
    const vault = await loadVault()
    // Create the master key via a normal write.
    await vault.saveSecureApiCredentials({ apiId: 1, apiHash: 'h' })
    const key = vaultStore.keys.get(MASTER_KEY_ID)
    if (!key) {
      throw new Error('expected a master key')
    }

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const legacyPlaintext = new TextEncoder().encode(JSON.stringify({ sessionString: 'legacy' }))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      legacyPlaintext,
    )
    vaultStore.secrets.set('account:legacy', { id: 'account:legacy', iv, ciphertext })

    expect(await vault.loadSecureAccountSecret('legacy')).toEqual({ sessionString: 'legacy' })
  })

  it('read path never creates a key when the master key is missing', async () => {
    const vault = await loadVault()
    // A secret exists but the key does not (corrupt/partial vault state).
    vaultStore.secrets.set('api-credentials', {
      id: 'api-credentials',
      iv: new Uint8Array(12),
      ciphertext: new ArrayBuffer(16),
    })

    await expect(vault.loadSecureApiCredentials()).rejects.toBeInstanceOf(
      vault.VaultKeyUnavailableError,
    )
    expect(vaultStore.keys.has(MASTER_KEY_ID)).toBe(false)
  })

  it('write path clears unreadable orphans before creating a new key', async () => {
    const vault = await loadVault()
    // Orphaned secret with no master key present.
    vaultStore.secrets.set('account:orphan', {
      id: 'account:orphan',
      iv: new Uint8Array(12),
      ciphertext: new ArrayBuffer(16),
    })

    await vault.saveSecureAccountSecret('fresh', { sessionString: 'new-session' })

    expect(vaultStore.keys.has(MASTER_KEY_ID)).toBe(true)
    expect(vaultStore.secrets.has('account:orphan')).toBe(false)
    // The freshly written secret is readable under the new key.
    expect(await vault.loadSecureAccountSecret('fresh')).toEqual({ sessionString: 'new-session' })
  })

  it('rejects a decrypted value that fails shape validation', async () => {
    const vault = await loadVault()
    await vault.saveSecureApiCredentials({ apiId: 1, apiHash: 'h' })
    const key = vaultStore.keys.get(MASTER_KEY_ID)
    if (!key) {
      throw new Error('expected a master key')
    }

    // Encrypt a structurally-invalid credentials payload with the right key + AAD.
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(JSON.stringify({ v: 1, data: { apiId: 'nope' } }))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('api-credentials') },
      key,
      plaintext,
    )
    vaultStore.secrets.set('api-credentials', { id: 'api-credentials', iv, ciphertext })

    await expect(vault.loadSecureApiCredentials()).rejects.toThrow(/validation/)
  })

  it('creates the master key under a cross-tab Web Lock when available', async () => {
    const request = vi.fn(async (_name: string, cb: () => Promise<unknown>) => cb())
    vi.stubGlobal('navigator', { locks: { request } })

    const vault = await loadVault()
    await vault.saveSecureAccountSecret('acc', { sessionString: 's' })

    expect(request).toHaveBeenCalledWith(
      'telegram-toolset:vault-master-key',
      expect.any(Function),
    )
    expect(vaultStore.keys.has(MASTER_KEY_ID)).toBe(true)
  })

  it('reuses a key another tab created while waiting for the lock', async () => {
    const winnerKey = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const request = vi.fn(async (_name: string, cb: () => Promise<unknown>) => {
      // Simulate the winning tab installing the key before we enter the critical section.
      vaultStore.keys.set(MASTER_KEY_ID, winnerKey)
      return cb()
    })
    vi.stubGlobal('navigator', { locks: { request } })

    const vault = await loadVault()
    await vault.saveSecureAccountSecret('acc', { sessionString: 's' })

    // The existing key was reused rather than overwritten by a freshly minted one.
    expect(vaultStore.keys.get(MASTER_KEY_ID)).toBe(winnerKey)
  })

  it('falls back to add-if-absent creation when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {})

    const vault = await loadVault()
    await vault.saveSecureAccountSecret('acc', { sessionString: 's' })

    expect(vaultStore.keys.has(MASTER_KEY_ID)).toBe(true)
    expect(await vault.loadSecureAccountSecret('acc')).toEqual({ sessionString: 's' })
  })
})
