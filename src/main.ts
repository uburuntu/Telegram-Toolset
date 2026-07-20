import './polyfills'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import i18n, { initializeLocale } from './i18n'
import router from './router'

async function bootstrap(): Promise<void> {
  // Load the stored/detected locale before mounting so non-English users don't
  // see a flash of the bundled fallback catalog.
  await initializeLocale()

  const app = createApp(App)

  app.use(createPinia())
  app.use(router)
  app.use(i18n)

  app.mount('#app')
}

void bootstrap()
