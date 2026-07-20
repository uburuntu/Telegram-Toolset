import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Non-default locales are code-split, so a chunk fetch can fail at runtime (offline, a stale hashed
 * chunk after a redeploy, a CDN hiccup). These tests pin the fallback contract: a failed load must
 * never leave the app on a broken/unmounted state, and must never persist a preference we cannot
 * honor. Each case resets the module graph and mocks a specific locale chunk to reject on import.
 */
describe('i18n locale-load resilience', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    document.documentElement.lang = ''
    document.documentElement.dir = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('@/i18n/locales/ar.json')
    vi.doUnmock('@/i18n/locales/ru.json')
  })

  it('falls back to English when the stored locale chunk fails to load', async () => {
    localStorage.setItem('app_locale', 'ar')
    vi.doMock('@/i18n/locales/ar.json', () => {
      throw new Error('chunk fetch failed')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { initializeLocale, i18n } = await import('@/i18n')
    // Must resolve (not reject) so the caller can always mount the app.
    await expect(initializeLocale()).resolves.toBeUndefined()

    expect(i18n.global.locale.value).toBe('en')
    // The optimistic RTL document direction is reset to English's LTR on fallback.
    expect(document.documentElement.dir).toBe('ltr')
    expect(document.documentElement.lang).toBe('en')
    expect(consoleError).toHaveBeenCalled()
  })

  it('keeps the current locale and does not persist a preference when a switch fails', async () => {
    vi.doMock('@/i18n/locales/ru.json', () => {
      throw new Error('chunk fetch failed')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { setLocale, i18n } = await import('@/i18n')
    await expect(setLocale('ru')).resolves.toBeUndefined()

    expect(i18n.global.locale.value).toBe('en')
    // A failed switch must not leave a broken preference that would strand the next startup.
    expect(localStorage.getItem('app_locale')).toBeNull()
  })
})
