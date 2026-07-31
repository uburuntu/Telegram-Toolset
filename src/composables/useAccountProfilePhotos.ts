import { shallowReactive } from 'vue'
import { telegramAccountGateway } from '@/services/telegram/gateway'

const photoUrls = shallowReactive(new Map<string, string>())
const resolvedAccountIds = new Set<string>()
const inFlightLoads = new Map<string, Promise<string | null>>()
const accountGenerations = new Map<string, number>()

function revokePhotoUrl(accountId: string): void {
  const url = photoUrls.get(accountId)
  if (url) {
    URL.revokeObjectURL(url)
    photoUrls.delete(accountId)
  }
}

export function useAccountProfilePhotos() {
  function photoUrlFor(accountId: string | null | undefined): string | null {
    return accountId ? (photoUrls.get(accountId) ?? null) : null
  }

  async function loadAccountProfilePhoto(accountId: string): Promise<string | null> {
    if (resolvedAccountIds.has(accountId)) {
      return photoUrls.get(accountId) ?? null
    }

    const existingLoad = inFlightLoads.get(accountId)
    if (existingLoad) {
      return existingLoad
    }

    const generation = accountGenerations.get(accountId) ?? 0
    const load = (async () => {
      try {
        const blob = await telegramAccountGateway.downloadMyProfilePhoto()
        if ((accountGenerations.get(accountId) ?? 0) !== generation) {
          return null
        }

        resolvedAccountIds.add(accountId)
        if (!blob) {
          return null
        }

        const url = URL.createObjectURL(blob)
        revokePhotoUrl(accountId)
        photoUrls.set(accountId, url)
        return url
      } catch {
        // Optional profile media must never make account switching fail. Leave it unresolved so a
        // later ready-session transition can retry.
        return null
      }
    })().finally(() => {
      if (inFlightLoads.get(accountId) === load) {
        inFlightLoads.delete(accountId)
      }
    })

    inFlightLoads.set(accountId, load)
    return load
  }

  function discardAccountProfilePhoto(accountId: string): void {
    accountGenerations.set(accountId, (accountGenerations.get(accountId) ?? 0) + 1)
    resolvedAccountIds.delete(accountId)
    inFlightLoads.delete(accountId)
    revokePhotoUrl(accountId)
  }

  function pruneAccountProfilePhotos(accountIds: ReadonlySet<string>): void {
    const knownAccountIds = new Set([
      ...photoUrls.keys(),
      ...resolvedAccountIds,
      ...inFlightLoads.keys(),
    ])
    for (const accountId of knownAccountIds) {
      if (!accountIds.has(accountId)) {
        discardAccountProfilePhoto(accountId)
      }
    }
  }

  return {
    photoUrlFor,
    loadAccountProfilePhoto,
    discardAccountProfilePhoto,
    pruneAccountProfilePhotos,
  }
}
