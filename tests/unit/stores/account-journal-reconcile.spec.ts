import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * End-to-end startup reconciliation of the account journal against a real IndexedDB vault. Each case
 * seeds the durable stores at a specific crash point — a dangling
 * journal entry plus whatever landed in the vault/localStorage before the process died — then drives
 * the real `loadFromStorage`, which reconciles before hydrating the reactive refs.
 *
 * Recovery and cross-tab wiring are inert here so the assertions isolate journal reconciliation.
 */
vi.mock('@/services/storage/backup-manager', () => ({
  backupManager: {
    archiveBackupsForRemovedAccount: vi.fn(async () => 0),
    recoverArchivedBackupsForAccount: vi.fn(async () => 0),
  },
}))
vi.mock('@/services/llm-export/chat-history-service', () => ({
  chatHistoryService: {
    archiveChatExportsForRemovedAccount: vi.fn(async () => 0),
    recoverArchivedChatExportsForAccount: vi.fn(async () => 0),
  },
}))
vi.mock('@/services/storage/cross-tab', () => ({
  createInvalidationChannel: () => ({ post: vi.fn(), close: vi.fn() }),
}))

const ACCOUNTS_KEY = 'telegram_accounts'
const ACTIVE_KEY = 'telegram_active_account'

beforeEach(() => {
  ;(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  localStorage.clear()
  vi.resetModules()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function storedUserAccount(id: string, label: string) {
  return {
    id,
    type: 'user' as const,
    label,
    phone: '+10000000000',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
  }
}

function journalRecord(
  op: 'add' | 'update' | 'remove',
  accountId: string,
  accounts: unknown[],
  activeAccountId: string | null = null,
) {
  return { id: accountId, op, accountId, metadata: { accounts, activeAccountId }, createdAt: 1 }
}

/**
 * Import the real modules after the per-test module reset so they bind to the fresh IndexedDB engine
 * and a fresh Pinia instance from the same module graph.
 */
async function setup() {
  const { createPinia, setActivePinia } = await import('pinia')
  setActivePinia(createPinia())

  const idb = await import('@/services/storage/indexed-db')
  const vault = await import('@/services/storage/secure-account-vault')
  const { useAccountsStore } = await import('@/stores/accounts')

  return { idb, vault, useAccountsStore }
}

describe('account journal startup reconciliation', () => {
  it('finishes a crashed remove: clears the ghost metadata and any lingering secret', async () => {
    const { idb, vault, useAccountsStore } = await setup()
    await vault.saveSecureAccountSecret('acc-1', { sessionString: 'still-here' })
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([storedUserAccount('acc-1', 'Ghost')]))
    localStorage.setItem(ACTIVE_KEY, 'acc-1')
    await idb.putAccountJournalRecord(journalRecord('remove', 'acc-1', []))

    const store = useAccountsStore()
    await store.loadFromStorage()

    expect(store.accounts).toHaveLength(0)
    expect(localStorage.getItem(ACCOUNTS_KEY)).toBeNull()
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull()
    expect(await vault.hasSecureAccountSecret('acc-1')).toBe(false)
    expect(await idb.getAllAccountJournalRecords()).toHaveLength(0)
  })

  it('rolls a crashed add forward when its secret landed', async () => {
    const { idb, vault, useAccountsStore } = await setup()
    await vault.saveSecureAccountSecret('acc-1', { sessionString: 'sess' })
    // localStorage was never updated (crash between the IndexedDB write and the localStorage write).
    await idb.putAccountJournalRecord(
      journalRecord('add', 'acc-1', [storedUserAccount('acc-1', 'New')]),
    )

    const store = useAccountsStore()
    await store.loadFromStorage()

    expect(store.accounts.map((account) => account.id)).toEqual(['acc-1'])
    expect(store.accounts[0]?.sessionString).toBe('sess')
    const persisted = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]')
    expect(persisted.map((account: { id: string }) => account.id)).toEqual(['acc-1'])
    expect(await idb.getAllAccountJournalRecords()).toHaveLength(0)
  })

  it('rolls a crashed add back when its secret never landed (no ghost account)', async () => {
    const { idb, useAccountsStore } = await setup()
    // No secret was ever written and localStorage was never updated.
    await idb.putAccountJournalRecord(
      journalRecord('add', 'acc-1', [storedUserAccount('acc-1', 'New')]),
    )

    const store = useAccountsStore()
    await store.loadFromStorage()

    expect(store.accounts).toHaveLength(0)
    expect(localStorage.getItem(ACCOUNTS_KEY)).toBeNull()
    expect(await idb.getAllAccountJournalRecords()).toHaveLength(0)
  })

  it('keeps a committed secret-less account whose metadata landed without a vault secret', async () => {
    const { idb, vault, useAccountsStore } = await setup()
    // A secret-less account (e.g. an empty user session) commits its metadata but writes no vault
    // secret. Metadata is the mutation's final durable step, so a listed account means it committed;
    // the interrupted journal-clear leaves a dangling entry that must not delete the account.
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([storedUserAccount('acc-1', 'Sessionless')]))
    localStorage.setItem(ACTIVE_KEY, 'acc-1')
    await idb.putAccountJournalRecord(
      journalRecord('add', 'acc-1', [storedUserAccount('acc-1', 'Sessionless')], 'acc-1'),
    )

    const store = useAccountsStore()
    await store.loadFromStorage()

    expect(store.accounts.map((account) => account.id)).toEqual(['acc-1'])
    expect(await vault.hasSecureAccountSecret('acc-1')).toBe(false)
    const persisted = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]')
    expect(persisted.map((account: { id: string }) => account.id)).toEqual(['acc-1'])
    expect(await idb.getAllAccountJournalRecords()).toHaveLength(0)
  })

  it('rolls a crashed update forward, re-applying the intended metadata', async () => {
    const { idb, vault, useAccountsStore } = await setup()
    await vault.saveSecureAccountSecret('acc-1', { sessionString: 'sess' })
    // localStorage still holds the pre-update label; the new label is only in the journal snapshot.
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([storedUserAccount('acc-1', 'Old Label')]))
    await idb.putAccountJournalRecord(
      journalRecord('update', 'acc-1', [storedUserAccount('acc-1', 'New Label')]),
    )

    const store = useAccountsStore()
    await store.loadFromStorage()

    expect(store.accounts[0]?.label).toBe('New Label')
    const persisted = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]')
    expect(persisted[0].label).toBe('New Label')
    expect(await idb.getAllAccountJournalRecords()).toHaveLength(0)
  })

  it('is an idempotent no-op when both stores already committed before the crash', async () => {
    const { idb, vault, useAccountsStore } = await setup()
    await vault.saveSecureAccountSecret('acc-1', { sessionString: 'sess' })
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([storedUserAccount('acc-1', 'Done')]))
    await idb.putAccountJournalRecord(
      journalRecord('add', 'acc-1', [storedUserAccount('acc-1', 'Done')]),
    )

    const store = useAccountsStore()
    await store.loadFromStorage()

    expect(store.accounts.map((account) => account.id)).toEqual(['acc-1'])
    expect(store.accounts[0]?.label).toBe('Done')
    expect(await idb.getAllAccountJournalRecords()).toHaveLength(0)
  })

  it('rolls forward without clobbering an account another tab persisted meanwhile', async () => {
    const { idb, vault, useAccountsStore } = await setup()
    await vault.saveSecureAccountSecret('acc-1', { sessionString: 's1' })
    await vault.saveSecureAccountSecret('acc-2', { sessionString: 's2' })
    // Another tab persisted acc-2 after this crashed op captured its acc-1-only snapshot.
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([storedUserAccount('acc-2', 'Other Tab')]))
    await idb.putAccountJournalRecord(
      journalRecord('add', 'acc-1', [storedUserAccount('acc-1', 'Crashed')], 'acc-1'),
    )

    const store = useAccountsStore()
    await store.loadFromStorage()

    expect(store.accounts.map((account) => account.id).sort()).toEqual(['acc-1', 'acc-2'])
    expect(await idb.getAllAccountJournalRecords()).toHaveLength(0)
  })
})
