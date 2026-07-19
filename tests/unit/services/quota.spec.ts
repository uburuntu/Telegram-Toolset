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

  describe('getPersistenceStatus', () => {
    it('reports persisted when the browser granted persistence', async () => {
      vi.stubGlobal('navigator', {
        storage: { persisted: vi.fn().mockResolvedValue(true) },
      })

      expect(await quotaManager.getPersistenceStatus()).toBe('persisted')
    })

    it('reports best-effort when persistence is available but not granted', async () => {
      vi.stubGlobal('navigator', {
        storage: { persisted: vi.fn().mockResolvedValue(false) },
      })

      expect(await quotaManager.getPersistenceStatus()).toBe('best-effort')
    })

    it('reports unsupported when the persistence API is missing', async () => {
      vi.stubGlobal('navigator', { storage: {} })

      expect(await quotaManager.getPersistenceStatus()).toBe('unsupported')
    })

    it('does not request persistence (read-only probe)', async () => {
      const persist = vi.fn().mockResolvedValue(true)
      vi.stubGlobal('navigator', {
        storage: { persist, persisted: vi.fn().mockResolvedValue(false) },
      })

      await quotaManager.getPersistenceStatus()

      expect(persist).not.toHaveBeenCalled()
    })
  })

  describe('ensurePersisted', () => {
    it('requests persistence and returns persisted when granted', async () => {
      const persist = vi.fn().mockResolvedValue(true)
      vi.stubGlobal('navigator', {
        storage: { persist, persisted: vi.fn().mockResolvedValue(false) },
      })

      expect(await quotaManager.ensurePersisted()).toBe('persisted')
      expect(persist).toHaveBeenCalledTimes(1)
    })

    it('returns best-effort when persistence is denied', async () => {
      vi.stubGlobal('navigator', {
        storage: { persist: vi.fn().mockResolvedValue(false), persisted: vi.fn().mockResolvedValue(false) },
      })

      expect(await quotaManager.ensurePersisted()).toBe('best-effort')
    })

    it('does not re-request when already persisted', async () => {
      const persist = vi.fn().mockResolvedValue(true)
      vi.stubGlobal('navigator', {
        storage: { persist, persisted: vi.fn().mockResolvedValue(true) },
      })

      expect(await quotaManager.ensurePersisted()).toBe('persisted')
      expect(persist).not.toHaveBeenCalled()
    })

    it('returns unsupported when persistence is unavailable', async () => {
      vi.stubGlobal('navigator', { storage: {} })

      expect(await quotaManager.ensurePersisted()).toBe('unsupported')
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

