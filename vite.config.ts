import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  plugins: [vue(), ...tailwindcss()],
  resolve: {
    alias: [{ find: '@', replacement: resolve(import.meta.dirname, 'src') }],
  },
  define: {
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  optimizeDeps: {
    include: ['idb', 'jszip'],
    // mtcute loads its WASM module through the browser runtime; pre-bundling breaks that path.
    exclude: ['@mtcute/wasm'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
})
