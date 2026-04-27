import { defineConfig, mergeConfig } from 'vitest/config'

import { sharedVitestConfig } from './vitest.config.shared'

export default mergeConfig(
  sharedVitestConfig,
  defineConfig({
    test: {
      include: ['tests/component/**/*.spec.ts'],
      passWithNoTests: false,
      coverage: {
        reportsDirectory: 'coverage/component',
      },
    },
  }),
)
