import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { quotaManager } from '@/services/storage/quota'

describe('QuotaManager', () => {
  const mockEstimate = vi.fn()

  beforeEach(() => {
    // Mock navigator.storage
    vi.stubGlobal('navigator', {
      storage: {
        estimate: mockEstimate,
        persist: vi.fn().mockResolvedValue(true),
        persisted: vi.fn().mockResolvedValue(false),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  describe('getStorageEstimate', () => {
    it('should return storage estimate', async () => {
      mockEstimate.mockResolvedValue({
        usage: 500_000_000, // 500MB used
        quota: 1_000_000_000, // 1GB quota
      })

      const estimate = await quotaManager.getStorageEstimate()

      expect(estimate.used).toBe(500_000_000)
      expect(estimate.available).toBe(500_000_000)
      expect(estimate.percentUsed).toBe(50)
    })

    it('should return fallback if storage API unavailable', async () => {
      vi.stubGlobal('navigator', { storage: undefined })

      const estimate = await quotaManager.getStorageEstimate()

      expect(estimate.used).toBe(0)
      expect(estimate.available).toBe(1_000_000_000)
    })
  })

  describe('checkCanStore', () => {
    it('should allow storage when space available', async () => {
      mockEstimate.mockResolvedValue({
        usage: 100_000_000,
        quota: 1_000_000_000,
      })

      const result = await quotaManager.checkCanStore(50_000_000)

      expect(result.canStore).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should warn when approaching limit', async () => {
      mockEstimate.mockResolvedValue({
        usage: 750_000_000,
        quota: 1_000_000_000,
      })

      const result = await quotaManager.checkCanStore(100_000_000)

      expect(result.canStore).toBe(true)
      expect(result.reason).toBe('low_space_warning')
    })

    it('should reject when would exceed quota', async () => {
      mockEstimate.mockResolvedValue({
        usage: 950_000_000,
        quota: 1_000_000_000,
      })

      const result = await quotaManager.checkCanStore(100_000_000)

      expect(result.canStore).toBe(false)
      expect(result.reason).toBe('quota_exceeded')
      expect(result.suggestedAction).toBe('download_instead')
    })
  })

  describe('determineExportStrategy', () => {
    it('should use IndexedDB for small exports', async () => {
      mockEstimate.mockResolvedValue({
        usage: 100_000_000,
        quota: 1_000_000_000,
      })

      const strategy = await quotaManager.determineExportStrategy(10_000_000)

      expect(strategy.type).toBe('indexeddb')
      expect(strategy.storeMedia).toBe(true)
    })

    it('should stream large exports when low on space', async () => {
      mockEstimate.mockResolvedValue({
        usage: 800_000_000,
        quota: 1_000_000_000,
      })

      const strategy = await quotaManager.determineExportStrategy(200_000_000)

      expect(strategy.type).toBe('stream_download')
      expect(strategy.storeMedia).toBe(false)
    })
  })
})

