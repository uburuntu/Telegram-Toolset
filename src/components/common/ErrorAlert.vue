<script setup lang="ts">
/**
 * Error Alert component
 *
 * Displays error messages with optional retry action.
 * Consistent styling for all error states.
 */

interface Props {
  message: string
  title?: string
  showRetry?: boolean
  showDismiss?: boolean
}

withDefaults(defineProps<Props>(), {
  title: 'Error',
  showRetry: false,
  showDismiss: false,
})

const emit = defineEmits<{
  retry: []
  dismiss: []
}>()
</script>

<template>
  <div
    class="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800"
  >
    <div class="flex items-start gap-3">
      <div class="flex-shrink-0 text-red-600 dark:text-red-400">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <div class="flex-1 min-w-0">
        <h4 class="font-medium text-red-800 dark:text-red-200 text-sm">
          {{ title }}
        </h4>
        <p class="mt-0.5 text-sm text-red-700 dark:text-red-300">
          {{ message }}
        </p>
        <div v-if="showRetry || showDismiss" class="mt-3 flex gap-2">
          <button
            v-if="showRetry"
            @click="emit('retry')"
            class="px-3 py-1 rounded text-xs font-medium bg-red-100 dark:bg-red-800/50 text-red-800 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-800 transition-colors duration-100"
          >
            Try Again
          </button>
          <button
            v-if="showDismiss"
            @click="emit('dismiss')"
            class="px-3 py-1 rounded text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 transition-colors duration-100"
          >
            Dismiss
          </button>
        </div>
      </div>
      <button
        v-if="showDismiss"
        @click="emit('dismiss')"
        class="flex-shrink-0 text-red-400 hover:text-red-600 dark:hover:text-red-200 transition-colors duration-100"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  </div>
</template>
