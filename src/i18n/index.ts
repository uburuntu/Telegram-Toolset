/**
 * Vue i18n configuration
 */

import { createI18n } from 'vue-i18n'
import ar from './locales/ar.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fa from './locales/fa.json'
import id from './locales/id.json'
import pt from './locales/pt.json'
import ru from './locales/ru.json'
import tr from './locales/tr.json'
import uk from './locales/uk.json'
import uz from './locales/uz.json'

export type SupportedLocale = 'en' | 'ru' | 'es' | 'id' | 'pt' | 'fa' | 'ar' | 'uz' | 'tr' | 'uk'

const LOCALE_STORAGE_KEY = 'app_locale'
const RTL_LANGUAGES: SupportedLocale[] = ['ar', 'fa']

const SUPPORTED_LOCALES: SupportedLocale[] = [
  'en',
  'ru',
  'es',
  'id',
  'pt',
  'fa',
  'ar',
  'uz',
  'tr',
  'uk',
]

function getStoredLocale(): SupportedLocale {
  const stored =
    typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
      ? localStorage.getItem(LOCALE_STORAGE_KEY)
      : null
  if (stored && SUPPORTED_LOCALES.includes(stored as SupportedLocale)) {
    return stored as SupportedLocale
  }

  // Detect browser language
  const browserLang =
    typeof navigator !== 'undefined' && typeof navigator.language === 'string'
      ? navigator.language.split('-')[0]
      : null
  if (SUPPORTED_LOCALES.includes(browserLang as SupportedLocale)) {
    return browserLang as SupportedLocale
  }

  return 'en'
}

function updateDocumentLocale(locale: SupportedLocale): void {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.lang = locale
  document.documentElement.dir = RTL_LANGUAGES.includes(locale) ? 'rtl' : 'ltr'
}

export function setLocale(locale: SupportedLocale): void {
  if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }
  i18n.global.locale.value = locale
  updateDocumentLocale(locale)
}

export const i18n = createI18n({
  legacy: false,
  locale: getStoredLocale(),
  fallbackLocale: 'en',
  messages: {
    en,
    ru,
    es,
    id,
    pt,
    fa,
    ar,
    uz,
    tr,
    uk,
  },
})

// Initialize direction on load
const initialLocale = getStoredLocale()
updateDocumentLocale(initialLocale)

export default i18n
