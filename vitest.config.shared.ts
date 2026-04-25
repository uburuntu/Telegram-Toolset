import { resolve } from 'node:path'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export const sharedVitestConfig = defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov', 'html'],
      exclude: [
        'coverage/**',
        'dist/**',
        'tests/**',
        '**/*.d.ts',
        'src/**/*.spec.ts',
        'src/main.ts',
        'src/router/**',
        'src/i18n/**',
        'src/shims/**',
        'src/types/**',
        // The legacy Telegram singleton is still a monolith and is being decomposed behind
        // the gateway. We keep direct behavioral tests for it, but do not use it to drive
        // the unit-coverage gate until that split lands.
        'src/services/telegram/client.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
