import type { ComputedRef } from 'vue'
import { watch } from 'vue'
import { resendService } from '@/services/resend/resend-service'
import { telegramService } from '@/services/telegram/client'
import { useAccountsStore } from '@/stores'

export function useActiveUserSessionSync(showLoginModal: ComputedRef<boolean>): void {
  const accountsStore = useAccountsStore()
  let requestedGeneration = 0
  let sessionQueue = Promise.resolve()

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
      const generation = ++requestedGeneration
      const transitionGeneration = telegramService.beginActiveAccountTransition()
      sessionQueue = sessionQueue.then(
        () => synchronizeSession(generation, transitionGeneration),
        () => synchronizeSession(generation, transitionGeneration),
      )
    },
    { immediate: true, flush: 'sync' },
  )

  async function synchronizeSession(
    generation: number,
    transitionGeneration: number,
  ): Promise<void> {
    try {
      await applySession(generation)
    } finally {
      telegramService.completeActiveAccountTransition(transitionGeneration)
    }
  }

  async function applySession(generation: number): Promise<void> {
    if (generation !== requestedGeneration) {
      return
    }

    // Never replace the mutable Telegram session while a cancelled send can still settle.
    await resendService.cancelAndWait()
    if (generation !== requestedGeneration) {
      return
    }

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
  }
}
