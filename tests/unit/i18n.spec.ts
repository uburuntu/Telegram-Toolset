import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '@/i18n'

describe('document locale metadata', () => {
  afterEach(async () => {
    await setLocale('en')
  })

  it('updates the document language and direction for RTL locales', async () => {
    await setLocale('ar')

    expect(document.documentElement.lang).toBe('ar')
    expect(document.documentElement.dir).toBe('rtl')
  })

  it('restores left-to-right direction for non-RTL locales', async () => {
    await setLocale('fa')
    await setLocale('ru')

    expect(document.documentElement.lang).toBe('ru')
    expect(document.documentElement.dir).toBe('ltr')
  })
})
