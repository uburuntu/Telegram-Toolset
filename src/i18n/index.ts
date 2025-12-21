/**
 * Vue i18n configuration
 */

import { createI18n } from 'vue-i18n'
import en from './locales/en.json'
import ru from './locales/ru.json'

export type SupportedLocale = 'en' | 'ru'

const LOCALE_STORAGE_KEY = 'app_locale'

function getStoredLocale(): SupportedLocale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
  if (stored === 'en' || stored === 'ru') {
    return stored
  }
  // Detect browser language
  const browserLang = navigator.language.split('-')[0]
  if (browserLang === 'ru') {
    return 'ru'
  }
  return 'en'
}

export function setLocale(locale: SupportedLocale): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  i18n.global.locale.value = locale
}

export const i18n = createI18n({
  legacy: false,
  locale: getStoredLocale(),
  fallbackLocale: 'en',
  messages: {
    en,
    ru,
  },
})

export default i18n
