/**
 * Application-wide {@link TelegramSessionCoordinator} bound to the real GramJS-backed services.
 *
 * Kept separate from the coordinator class so the class stays pure and unit-testable without pulling
 * in the Telegram singleton or the resend service.
 */

import { cancelMutationJobsAndWait } from '@/services/jobs/job-runner'
import { resendService } from '@/services/resend/resend-service'
import { telegramService } from '@/services/telegram/client'
import type { SessionBackend } from './session-coordinator'
import { TelegramSessionCoordinator } from './session-coordinator'

const defaultBackend: SessionBackend = {
  beginTransition: () => telegramService.beginActiveAccountTransition(),
  completeTransition: (token) => telegramService.completeActiveAccountTransition(token),
  cancelPendingMutations: async () => {
    await Promise.all([resendService.cancelAndWait(), cancelMutationJobsAndWait()])
  },
  activateUserSession: (request) =>
    telegramService.useUserAccountSession({
      accountId: request.accountId,
      sessionString: request.sessionString,
      apiId: request.credentials.apiId,
      apiHash: request.credentials.apiHash,
    }),
  teardownUserSession: async () => {
    try {
      await telegramService.disconnect()
    } catch {
      // Best-effort cleanup when leaving a user session.
    }
  },
}

export const sessionCoordinator = new TelegramSessionCoordinator({ backend: defaultBackend })
