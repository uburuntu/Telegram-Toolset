import { telegramService } from '../client'
import { createTelegramGateway } from './service-adapter'

export * from './contracts'
export type { TelegramServiceAdapterTarget } from './service-adapter'
export { createTelegramGateway }

const gateway = createTelegramGateway(telegramService)

export const telegramGateway = gateway
export const telegramAuthGateway = gateway.auth
export const telegramDialogsGateway = gateway.dialogs
export const telegramAdminLogGateway = gateway.adminLog
export const telegramEntityGateway = gateway.entities
export const telegramMediaGateway = gateway.media
export const telegramSendGateway = gateway.send
export const telegramScheduledGateway = gateway.scheduled
export const telegramTraceGateway = gateway.trace
export const telegramAccountGateway = gateway.account
export const telegramHistoryGateway = gateway.history
