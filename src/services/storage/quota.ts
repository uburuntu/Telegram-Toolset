/**
 * Storage quota management
 */

import type { StorageEstimate, StorageCheckResult, ExportStrategy } from '@/types'

const LOW_SPACE_THRESHOLD = 0.8 // 80%
const CRITICAL_SPACE_THRESHOLD = 0.95 // 95%
const SMALL_EXPORT_SIZE = 50_000_000 // 50MB

class QuotaManager {
  async getStorageEstimate(): Promise<StorageEstimate> {
    if (!navigator.storage?.estimate) {
      // Fallback for browsers without Storage API
      return {
        used: 0,
        available: 1_000_000_000, // Assume 1GB available
        percentUsed: 0,
      }
    }

    try {
      const estimate = await navigator.storage.estimate()
      const used = estimate.usage || 0
      const quota = estimate.quota || 1_000_000_000
      const available = quota - used

      return {
        used,
        available,
        percentUsed: (used / quota) * 100,
      }
    } catch {
      return {
        used: 0,
        available: 1_000_000_000,
        percentUsed: 0,
      }
    }
  }

  async checkCanStore(bytes: number): Promise<StorageCheckResult> {
    const estimate = await this.getStorageEstimate()
    const projectedUsage = estimate.used + bytes
    const projectedPercent = (projectedUsage / (estimate.used + estimate.available)) * 100

    if (projectedPercent >= CRITICAL_SPACE_THRESHOLD * 100) {
      return {
        canStore: false,
        reason: 'quota_exceeded',
        suggestedAction: 'download_instead',
      }
    }

    if (projectedPercent >= LOW_SPACE_THRESHOLD * 100) {
      return {
        canStore: true,
        reason: 'low_space_warning',
        suggestedAction: 'delete_old',
      }
    }

    return { canStore: true }
  }

  async requestPersistentStorage(): Promise<boolean> {
    if (!navigator.storage?.persist) {
      return false
    }

    try {
      return await navigator.storage.persist()
    } catch {
      return false
    }
  }

  async isPersisted(): Promise<boolean> {
    if (!navigator.storage?.persisted) {
      return false
    }

    try {
      return await navigator.storage.persisted()
    } catch {
      return false
    }
  }

  async determineExportStrategy(estimatedSize: number): Promise<ExportStrategy> {
    const estimate = await this.getStorageEstimate()

    // Small exports go to IndexedDB
    if (estimatedSize < SMALL_EXPORT_SIZE) {
      return { type: 'indexeddb', storeMedia: true }
    }

    // Check if we have enough space
    const projectedPercent =
      ((estimate.used + estimatedSize) / (estimate.used + estimate.available)) * 100

    if (projectedPercent < LOW_SPACE_THRESHOLD * 100) {
      // We have space, but warn if it's a significant portion
      if (estimatedSize > estimate.available * 0.3) {
        return { type: 'indexeddb', storeMedia: true, warnUser: true }
      }
      return { type: 'indexeddb', storeMedia: true }
    }

    // Not enough space - stream to download
    return {
      type: 'stream_download',
      storeMedia: false,
      storeMetadataOnly: true,
    }
  }
}

// Singleton instance
export const quotaManager = new QuotaManager()
