/**
 * Vue i18n configuration
 *
 * Only the fallback locale (`en`) is bundled into the main chunk. Every other
 * locale is code-split and fetched on demand the first time it is selected,
 * keeping the initial payload small. Call `initializeLocale()` during bootstrap
 * to load the stored locale before the app mounts (avoids a fallback flash).
 */

import { createI18n } from 'vue-i18n'
import en from './locales/en.json'

export type SupportedLocale = 'en' | 'ru' | 'es' | 'id' | 'pt' | 'fa' | 'ar' | 'uz' | 'tr' | 'uk'

type MessageSchema = typeof en

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

/**
 * Lazy loaders for every non-fallback locale. Each entry becomes its own
 * chunk so unused locales are never shipped in the initial bundle.
 */
const localeLoaders: Partial<Record<SupportedLocale, () => Promise<{ default: MessageSchema }>>> = {
  ru: () => import('./locales/ru.json') as Promise<{ default: MessageSchema }>,
  es: () => import('./locales/es.json') as Promise<{ default: MessageSchema }>,
  id: () => import('./locales/id.json') as Promise<{ default: MessageSchema }>,
  pt: () => import('./locales/pt.json') as Promise<{ default: MessageSchema }>,
  fa: () => import('./locales/fa.json') as Promise<{ default: MessageSchema }>,
  ar: () => import('./locales/ar.json') as Promise<{ default: MessageSchema }>,
  uz: () => import('./locales/uz.json') as Promise<{ default: MessageSchema }>,
  tr: () => import('./locales/tr.json') as Promise<{ default: MessageSchema }>,
  uk: () => import('./locales/uk.json') as Promise<{ default: MessageSchema }>,
}

const loadedLocales = new Set<SupportedLocale>(['en'])

export const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: {
    en,
  },
})

/**
 * `createI18n` infers the locale union from the eagerly-bundled `messages`
 * (only `en`), which narrows `locale.value` and `setLocaleMessage` to `'en'`.
 * Lazy loading deliberately registers other locales at runtime, so expose a
 * minimal widened view for those two mutation points.
 */
interface LocaleController {
  locale: { value: SupportedLocale }
  setLocaleMessage: (locale: SupportedLocale, message: MessageSchema) => void
}

const localeController = i18n.global as unknown as LocaleController

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

/**
 * Ensures the message catalog for a locale is registered, fetching the
 * code-split chunk on first use. Resolves immediately for already-loaded
 * locales and for `en` (bundled eagerly).
 */
export async function ensureLocaleLoaded(locale: SupportedLocale): Promise<void> {
  if (loadedLocales.has(locale)) {
    return
  }

  const loader = localeLoaders[locale]
  if (!loader) {
    return
  }

  const messages = await loader()
  localeController.setLocaleMessage(locale, messages.default)
  loadedLocales.add(locale)
}

export async function setLocale(locale: SupportedLocale): Promise<void> {
  if (typeof localStorage !== 'undefined' && typeof localStorage.setItem === 'function') {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  }
  await ensureLocaleLoaded(locale)
  localeController.locale.value = locale
  updateDocumentLocale(locale)
}

/**
 * Loads and applies the stored/detected locale. Await this before mounting so
 * non-English users don't see a flash of the fallback catalog.
 */
export async function initializeLocale(): Promise<void> {
  const locale = getStoredLocale()
  updateDocumentLocale(locale)
  if (locale === 'en') {
    return
  }
  await ensureLocaleLoaded(locale)
  localeController.locale.value = locale
}

// Set document direction/lang immediately so RTL layout is correct before the
// stored locale's messages finish loading.
updateDocumentLocale(getStoredLocale())

export default i18n
