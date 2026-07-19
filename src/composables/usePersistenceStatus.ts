import { type Ref, readonly, ref } from 'vue'
import { quotaManager } from '@/services/storage/quota'
import type { PersistenceStatus } from '@/types'

/**
 * Shared, reactive view of on-device storage durability (ARCHITECTURE.md §6).
 *
 * The status is module-scoped so every surface (backups, local-data workspace) reflects the same
 * value. `refresh()` is a read-only probe safe to call on load; `ensurePersisted()` actively requests
 * persistence and must only be called when the user starts a durable local-data workflow.
 */
const status: Ref<PersistenceStatus> = ref('unsupported')

export function usePersistenceStatus() {
  async function refresh(): Promise<PersistenceStatus> {
    status.value = await quotaManager.getPersistenceStatus()
    return status.value
  }

  async function ensurePersisted(): Promise<PersistenceStatus> {
    status.value = await quotaManager.ensurePersisted()
    return status.value
  }

  return { status: readonly(status), refresh, ensurePersisted }
}
