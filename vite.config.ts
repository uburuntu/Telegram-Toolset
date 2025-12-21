import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

function agentGramjsBrowserShimsPlugin(): Plugin {
  const shimPromisedNetSockets = resolve(__dirname, 'src/shims/telegram/PromisedNetSockets.ts')
  return {
    name: 'agent-gramjs-browser-shims',
    resolveId(id, importer) {
      const imp = (importer ?? '').replace(/\\/g, '/')

      // GramJS `telegram/extensions/index.js` eagerly requires `./PromisedNetSockets` (Node-only).
      if (id === './PromisedNetSockets' && imp.endsWith('/node_modules/telegram/extensions/index.js')) {
        return shimPromisedNetSockets
      }

      // Also cover direct deep-imports (rare, but keeps behavior consistent)
      if (id === 'telegram/extensions/PromisedNetSockets' || id === 'telegram/extensions/PromisedNetSockets.js') {
        return shimPromisedNetSockets
      }

      return null
    },
  }
}

export default defineConfig(() => {
  const shimPromisedNetSockets = resolve(__dirname, 'src/shims/telegram/PromisedNetSockets.ts')
  const config = {
    base: '/',
    plugins: [vue(), ...tailwindcss(), agentGramjsBrowserShimsPlugin()],
    resolve: {
      alias: [
        { find: '@', replacement: resolve(__dirname, 'src') },
        // GramJS (telegram) uses `require("util")` for inspect.custom; Vite doesn't polyfill Node built-ins.
        // Ensure we only alias the exact module IDs (no `util/*` subpaths).
        { find: /^util$/, replacement: resolve(__dirname, 'src/shims/util.ts') },
        { find: /^node:util$/, replacement: resolve(__dirname, 'src/shims/util.ts') },
      ],
    },
    define: {
      // Enable BigInt serialization for Telegram IDs
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    },
    optimizeDeps: {
      // Pre-bundle deps that otherwise trigger "504 (Outdated Optimize Dep)" during E2E runs.
      // When Vite re-optimizes deps mid-run, old `?v=...` prebundle URLs can start returning 504,
      // which aborts module evaluation for lazy routes (like ExportView).
      include: ['telegram', 'telegram/sessions', 'idb', 'jszip'],
      // Ensure our GramJS browser shims apply during dependency pre-bundling too.
      // The crash happens inside optimized deps (`node_modules/.vite/deps/...`), so a Rollup-only plugin isn't enough.
      esbuildOptions: {
        plugins: [
          {
            name: 'agent-gramjs-browser-shims-esbuild',
            setup(build: any) {
              build.onResolve(
                { filter: /^\.\/*PromisedNetSockets$/ },
                (args: { path: string; importer: string }) => {
                  const imp = (args.importer ?? '').replace(/\\/g, '/')
                  // Only rewrite the require from GramJS' extensions index.
                  if (/\/telegram\/extensions\/index\.js$/.test(imp)) {
                    return { path: shimPromisedNetSockets }
                  }
                  return null
                }
              )
            },
          },
        ],
      },
    },
    build: {
      target: 'esnext',
      rollupOptions: {
        output: {
          manualChunks: {
            telegram: ['telegram'],
            vendor: ['vue', 'vue-router', 'pinia'],
          },
        },
      },
    },
  }

  return config
})
