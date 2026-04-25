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
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
