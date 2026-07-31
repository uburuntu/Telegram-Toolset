import { convertFromGramjsSession } from '@mtcute/convert'
import {
  BaseTelegramClient,
  type BaseTelegramClientOptions,
  MemoryStorage,
  networkMiddlewares,
} from '@mtcute/web'

const MAX_FLOOD_WAIT_MS = 60_000
const MAX_FLOOD_RETRIES = 3

export type SavedSessionFormat = 'empty' | 'mtcute' | 'gramjs'

export interface MtcuteRuntimeCallbacks {
  onFloodWait?: (seconds: number, method: string) => void
}

function getClientLanguage(): string {
  if (typeof navigator === 'undefined') return 'en'
  return navigator.language.split('-')[0] || 'en'
}

export function createMtcuteClientOptions(
  apiId: number,
  apiHash: string,
  callbacks: MtcuteRuntimeCallbacks = {},
): BaseTelegramClientOptions {
  const language = getClientLanguage()

  return {
    apiId,
    apiHash,
    storage: new MemoryStorage(),
    disableUpdates: true,
    initConnectionOptions: {
      appVersion: '1.0',
      langCode: language,
      systemLangCode: language,
    },
    network: {
      connectionCount: (kind) => {
        if (kind === 'main') return 0
        if (kind === 'upload') return 2
        if (kind === 'download') return 3
        return 2
      },
      inactivityTimeout: 30_000,
      middlewares: networkMiddlewares.basic({
        floodWaiter: {
          maxWait: MAX_FLOOD_WAIT_MS,
          maxRetries: MAX_FLOOD_RETRIES,
          onBeforeWait: (context, seconds) => {
            callbacks.onFloodWait?.(seconds, context.request._)
          },
        },
        // A 500 response may arrive after a mutation was accepted. Retrying it blindly can
        // duplicate sends, so higher layers retry only operations they know are safe to repeat.
        internalErrors: { maxRetries: 0 },
      }),
    },
  }
}

export function createMtcuteClient(
  apiId: number,
  apiHash: string,
  callbacks: MtcuteRuntimeCallbacks = {},
): BaseTelegramClient {
  return new BaseTelegramClient(createMtcuteClientOptions(apiId, apiHash, callbacks))
}

export async function importSavedSession(
  client: BaseTelegramClient,
  sessionString: string,
): Promise<SavedSessionFormat> {
  if (!sessionString) return 'empty'

  try {
    await client.importSession(sessionString, true)
    return 'mtcute'
  } catch (mtcuteError) {
    try {
      await client.importSession(convertFromGramjsSession(sessionString), true)
      return 'gramjs'
    } catch {
      throw mtcuteError
    }
  }
}
