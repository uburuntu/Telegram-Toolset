import type { ComputedRef } from 'vue'
import { watch } from 'vue'
import type { DesiredSession } from '@/services/telegram/session-coordinator'
import { sessionCoordinator } from '@/services/telegram/session-coordinator-instance'
import { useAccountsStore } from '@/stores'

/**
 * Bridges reactive account state to the {@link TelegramSessionCoordinator}. This composable only
 * computes the desired session from the store and hands it to the coordinator, which owns
 * serialization, generation fencing, and bounded mutation cancellation.
 */
export function useActiveUserSessionSync(showLoginModal: ComputedRef<boolean>): void {
  const accountsStore = useAccountsStore()

  function computeDesiredSession(): DesiredSession {
    // An interactive login owns the session while its modal is open; do not fight it.
    if (showLoginModal.value) {
      return { kind: 'hold' }
    }

    const account = accountsStore.activeAccount
    if (!account || account.type !== 'user') {
      return { kind: 'teardown' }
    }

    if (accountsStore.activeAccountNeedsLogin) {
      return { kind: 'teardown' }
    }

    const credentials = accountsStore.apiCredentials
    if (!credentials) {
      // Missing shared credentials: keep whatever session exists rather than tearing it down.
      return { kind: 'hold' }
    }

    return {
      kind: 'activate',
      request: {
        accountId: account.id,
        sessionString: account.sessionString,
        credentials,
      },
    }
  }

  watch(
    () => [
      accountsStore.activeAccount?.id ?? null,
      accountsStore.activeAccount?.type ?? null,
      accountsStore.apiCredentials?.apiId ?? null,
      accountsStore.apiCredentials?.apiHash ?? null,
      accountsStore.activeAccountNeedsLogin,
      showLoginModal.value,
    ],
    () => {
      sessionCoordinator.requestSync(computeDesiredSession())
    },
    { immediate: true, flush: 'sync' },
  )
}
