import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  describe('initial state', () => {
    it('should have disconnected status', () => {
      const store = useAuthStore()
      expect(store.status).toBe('disconnected')
    })

    it('should not be authorized', () => {
      const store = useAuthStore()
      expect(store.isAuthorized).toBe(false)
    })

    it('should not have config', () => {
      const store = useAuthStore()
      expect(store.hasConfig).toBe(false)
    })
  })

  describe('setConfig', () => {
    it('should save config to state and localStorage', () => {
      const store = useAuthStore()
      store.setConfig(12345, 'abc123hash')
      
      expect(store.config?.apiId).toBe(12345)
      expect(store.config?.apiHash).toBe('abc123hash')
      expect(store.hasConfig).toBe(true)
      
      const stored = JSON.parse(localStorage.getItem('telegram_config') || '{}')
      expect(stored.apiId).toBe(12345)
    })

    it('should throw on invalid config', () => {
      const store = useAuthStore()
      expect(() => store.setConfig(0, 'hash')).toThrow()
      expect(() => store.setConfig(123, '')).toThrow()
    })
  })

  describe('loadConfig', () => {
    it('should load config from localStorage', () => {
      localStorage.setItem('telegram_config', JSON.stringify({
        apiId: 99999,
        apiHash: 'storedhash',
      }))
      
      const store = useAuthStore()
      const loaded = store.loadConfig()
      
      expect(loaded).toBe(true)
      expect(store.config?.apiId).toBe(99999)
    })

    it('should return false if no stored config', () => {
      const store = useAuthStore()
      expect(store.loadConfig()).toBe(false)
    })
  })

  describe('setAuthorized', () => {
    it('should update status and user info', () => {
      const store = useAuthStore()
      const user = {
        id: BigInt(123),
        firstName: 'Test',
        lastName: 'User',
      }
      
      store.setAuthorized(user)
      
      expect(store.status).toBe('authorized')
      expect(store.isAuthorized).toBe(true)
      expect(store.user?.firstName).toBe('Test')
    })
  })

  describe('logout', () => {
    it('should reset auth state', () => {
      const store = useAuthStore()
      store.setConfig(123, 'hash')
      store.setAuthorized({ id: BigInt(1), firstName: 'Test' })
      
      store.logout()
      
      expect(store.status).toBe('disconnected')
      expect(store.isAuthorized).toBe(false)
      expect(store.user).toBeNull()
      // Config should remain
      expect(store.hasConfig).toBe(true)
    })
  })

  describe('reset', () => {
    it('should clear everything including config', () => {
      const store = useAuthStore()
      store.setConfig(123, 'hash')
      store.setAuthorized({ id: BigInt(1), firstName: 'Test' })
      
      store.reset()
      
      expect(store.status).toBe('disconnected')
      expect(store.hasConfig).toBe(false)
      expect(localStorage.getItem('telegram_config')).toBeNull()
    })
  })
})

