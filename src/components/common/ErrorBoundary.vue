<script setup lang="ts">
/**
 * Error Boundary component
 *
 * Catches rendering errors in child components and displays a fallback UI.
 * Logs errors for debugging and provides recovery options.
 */

import { ref, onErrorCaptured } from 'vue'

interface Props {
  fallbackMessage?: string
}

const props = withDefaults(defineProps<Props>(), {
  fallbackMessage: 'Something went wrong',
})

const emit = defineEmits<{
  error: [error: Error]
}>()

const error = ref<Error | null>(null)
const errorInfo = ref<string>('')

onErrorCaptured((err, instance, info) => {
  error.value = err instanceof Error ? err : new Error(String(err))
  errorInfo.value = info

  // Log for debugging
  console.error('ErrorBoundary caught:', err)
  console.error('Component:', instance)
  console.error('Info:', info)

  emit('error', error.value)

  // Return false to prevent error from propagating
  return false
})

function reset() {
  error.value = null
  errorInfo.value = ''
}
</script>

<template>
  <div
    v-if="error"
    class="p-6 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
  >
    <div class="flex items-start gap-3">
      <div class="flex-shrink-0 text-red-600 dark:text-red-400">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <div class="flex-1">
        <h3 class="font-semibold text-red-800 dark:text-red-200">
          {{ props.fallbackMessage }}
        </h3>
        <p class="mt-1 text-sm text-red-700 dark:text-red-300">
          {{ error.message }}
        </p>
        <div class="mt-4 flex gap-2">
          <button
            @click="reset"
            class="px-3 py-1.5 rounded-md text-sm font-medium bg-red-100 dark:bg-red-800/50 text-red-800 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-800 transition-colors duration-100"
          >
            Try Again
          </button>
          <button
            @click="$router.push('/')"
            class="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            Go Home
          </button>
        </div>
      </div>
    </div>
  </div>
  <slot v-else />
</template>
