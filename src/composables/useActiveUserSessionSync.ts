import type { ComputedRef } from 'vue'
import { watch } from 'vue'
import { telegramService } from '@/services/telegram/client'
import { useAccountsStore } from '@/stores'

export function useActiveUserSessionSync(showLoginModal: ComputedRef<boolean>): void {
  const accountsStore = useAccountsStore()

  watch(
    () => [
      accountsStore.activeAccount?.id ?? null,
      accountsStore.activeAccount?.type ?? null,
      accountsStore.apiCredentials?.apiId ?? null,
      accountsStore.apiCredentials?.apiHash ?? null,
      showLoginModal.value,
    ],
    async () => {
      const account = accountsStore.activeAccount

      if (showLoginModal.value) {
        return
      }

      if (!account || account.type !== 'user') {
        try {
          await telegramService.disconnect()
        } catch {
          // Ignore best-effort cleanup when leaving a user session.
        }
        return
      }

      if (accountsStore.activeAccountNeedsLogin) {
        try {
          await telegramService.disconnect()
        } catch {
          // Ignore disconnect failures while surfacing the re-login state.
        }
        return
      }

      const creds = accountsStore.apiCredentials
      if (!creds) {
        return
      }

      if (!('useUserAccountSession' in telegramService)) {
        return
      }

      type SessionFn = (options: {
        accountId?: string
        sessionString?: string
        apiId: number
        apiHash: string
      }) => Promise<boolean>

      const useSession = telegramService.useUserAccountSession as SessionFn | undefined
      if (typeof useSession !== 'function') {
        return
      }

      try {
        await useSession({
          accountId: account.id,
          sessionString: account.sessionString,
          apiId: creds.apiId,
          apiHash: creds.apiHash,
        })
      } catch {
        // Avoid noisy startup errors; module UIs will surface reconnect state if needed.
      }
    },
    { immediate: true },
  )
}
