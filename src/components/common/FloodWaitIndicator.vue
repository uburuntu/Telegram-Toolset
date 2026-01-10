<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{
  /** Total wait time in seconds */
  seconds: number
  /** Remaining seconds in countdown */
  remaining: number
  /** Progress percentage (0-100) */
  progress: number
}>()

const { t } = useI18n()
</script>

<template>
  <div v-if="seconds > 0" class="text-amber-600 mb-3">
    <div class="flex items-center justify-center gap-2">
      <span class="animate-pulse">⏳</span>
      <span>{{ t('common.rateLimited', { seconds: remaining }) }}</span>
    </div>
    <!-- Countdown progress bar -->
    <div
      class="w-full max-w-xs mx-auto h-1.5 bg-amber-200 dark:bg-amber-900 rounded-full overflow-hidden mt-2"
    >
      <div
        class="h-full bg-amber-500 transition-all duration-1000 ease-linear"
        :style="{ width: `${progress}%` }"
      ></div>
    </div>
  </div>
</template>

