import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Real-IndexedDB + WebCrypto integration coverage for the account journal and vault. Each test gets
 * a fresh IndexedDB engine and a fresh module graph so `indexed-db.ts`'s cached connection is
 * rebound to the new engine instead of a previous test's orphaned database.
 */
beforeEach(() => {
  ;(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function importJournal() {
  return import('@/services/storage/account-journal')
}

function importIndexedDb() {
  return import('@/services/storage/indexed-db')
}

function importVault() {
  return import('@/services/storage/secure-account-vault')
}

function metadata(accounts: unknown[] = [], activeAccountId: string | null = null) {
  return { accounts, activeAccountId }
}

describe('account journal service (real IndexedDB)', () => {
  it('round-trips begin -> readPending -> complete', async () => {
    const journal = await importJournal()

    const id = await journal.beginAccountJournal({
      op: 'add',
      accountId: 'acc-1',
      metadata: metadata([{ id: 'acc-1' }], 'acc-1'),
    })
    expect(id).toBe('acc-1')

    const pending = await journal.readPendingAccountJournal()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ id: 'acc-1', op: 'add', accountId: 'acc-1' })
    expect(typeof pending[0]?.createdAt).toBe('number')

    await journal.completeAccountJournal(id)
    expect(await journal.readPendingAccountJournal()).toHaveLength(0)
  })

  it('keys entries by account id so a retry overwrites its own dangling entry', async () => {
    const journal = await importJournal()

    await journal.beginAccountJournal({
      op: 'add',
      accountId: 'acc-1',
      metadata: metadata(),
    })
    await journal.beginAccountJournal({
      op: 'update',
      accountId: 'acc-1',
      metadata: metadata(),
    })

    const pending = await journal.readPendingAccountJournal()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.op).toBe('update')
  })

  it('degrades to a no-op when IndexedDB is unavailable', async () => {
    const original = globalThis.indexedDB
    // Simulate a private-mode / SSR environment with no IndexedDB.
    ;(globalThis as unknown as { indexedDB: IDBFactory | undefined }).indexedDB = undefined
    vi.resetModules()

    try {
      const journal = await importJournal()
      expect(
        await journal.beginAccountJournal({
          op: 'add',
          accountId: 'acc-1',
          metadata: metadata(),
        }),
      ).toBeNull()
      expect(await journal.readPendingAccountJournal()).toEqual([])
      await expect(journal.completeAccountJournal('acc-1')).resolves.toBeUndefined()
    } finally {
      ;(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = original
    }
  })

  it('adds the accountJournal store on the v4 upgrade while preserving existing data', async () => {
    // Stand up an existing v3 database with data in an older store, then let the app open at v4.
    const v3 = await openDB('telegram-toolset', 3, {
      upgrade(db) {
        db.createObjectStore('backups', { keyPath: 'id' })
        db.createObjectStore('secureVaultSecrets', { keyPath: 'id' })
      },
    })
    await v3.put('secureVaultSecrets', {
      id: 'keep-me',
      iv: new Uint8Array(12),
      ciphertext: new ArrayBuffer(8),
    })
    v3.close()

    const idb = await importIndexedDb()
    await idb.putAccountJournalRecord({
      id: 'j1',
      op: 'add',
      accountId: 'a',
      metadata: metadata(),
      createdAt: 1,
    })

    const journalRecords = await idb.getAllAccountJournalRecords()
    expect(journalRecords.map((record) => record.id)).toContain('j1')

    // Data written before the upgrade survives it.
    const survivor = await idb.getSecureVaultSecret('keep-me')
    expect(survivor).toBeDefined()
  })
})

describe('secure vault (real IndexedDB + WebCrypto)', () => {
  it('persists and retrieves a non-extractable CryptoKey through IndexedDB', async () => {
    const idb = await importIndexedDb()

    const key = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    await idb.putSecureVaultKey('accounts-master-key', key)

    const loaded = await idb.getSecureVaultKey('accounts-master-key')
    expect(loaded).toBeInstanceOf(CryptoKey)

    // The key is still usable for its purpose after the store round-trip.
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      loaded as CryptoKey,
      new TextEncoder().encode('hello'),
    )
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      loaded as CryptoKey,
      ciphertext,
    )
    expect(new TextDecoder().decode(plaintext)).toBe('hello')
  })

  it('encrypts an account secret to IndexedDB and decrypts it back', async () => {
    const vault = await importVault()

    await vault.saveSecureAccountSecret('acc-1', { sessionString: 's3cr3t' })

    expect(await vault.hasSecureAccountSecret('acc-1')).toBe(true)
    expect(await vault.hasSecureAccountSecret('acc-2')).toBe(false)
    expect(await vault.loadSecureAccountSecret('acc-1')).toEqual({ sessionString: 's3cr3t' })
  })

  it('surfaces a corrupt ciphertext as an error without affecting healthy secrets', async () => {
    const idb = await importIndexedDb()
    const vault = await importVault()

    // A legitimate save mints the master key.
    await vault.saveSecureAccountSecret('acc-keep', { sessionString: 'ok' })

    // Overwrite one record's ciphertext with garbage that cannot decrypt under the master key.
    await idb.putSecureVaultSecret({
      id: 'account:acc-1',
      iv: globalThis.crypto.getRandomValues(new Uint8Array(12)),
      ciphertext: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]).buffer,
    })

    await expect(vault.loadSecureAccountSecret('acc-1')).rejects.toThrow()
    // The healthy secret remains readable — one corrupt record does not poison the vault.
    expect(await vault.loadSecureAccountSecret('acc-keep')).toEqual({ sessionString: 'ok' })
  })
})
