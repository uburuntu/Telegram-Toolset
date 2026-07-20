import './polyfills'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import i18n, { initializeLocale } from './i18n'
import router from './router'

async function bootstrap(): Promise<void> {
  // Load the stored/detected locale before mounting so non-English users don't see a flash of the
  // bundled fallback catalog. initializeLocale already falls back to English on a failed chunk
  // fetch; this catch is defense-in-depth so a locale problem can never leave the app unmounted.
  try {
    await initializeLocale()
  } catch (error) {
    console.error('Locale initialization failed; mounting with the default locale:', error)
  }

  const app = createApp(App)

  app.use(createPinia())
  app.use(router)
  app.use(i18n)

  app.mount('#app')
}

void bootstrap()
