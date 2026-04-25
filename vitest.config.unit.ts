import { defineConfig, mergeConfig } from 'vitest/config'

import { sharedVitestConfig } from './vitest.config.shared'

export default mergeConfig(
  sharedVitestConfig,
  defineConfig({
    test: {
      include: ['src/**/*.spec.ts', 'tests/unit/**/*.spec.ts'],
      coverage: {
        reportsDirectory: 'coverage/unit',
        thresholds: {
          statements: 75,
          branches: 55,
          functions: 68,
          lines: 75,
        },
      },
    },
  }),
)
