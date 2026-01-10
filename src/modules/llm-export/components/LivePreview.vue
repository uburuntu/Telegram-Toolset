<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  content: string
}>()

const { t } = useI18n()

const lineCount = computed(() => props.content.split('\n').length)
</script>

<template>
  <div
    class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
  >
    <div
      class="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700"
    >
      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
        {{ t('llmExport.preview') }}
      </h3>
      <span class="text-xs text-gray-500 dark:text-gray-400">
        {{ lineCount }} {{ t('llmExport.lines') }}
      </span>
    </div>

    <div class="relative">
      <!-- Empty state -->
      <div
        v-if="!content"
        class="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500"
      >
        <p class="text-sm">{{ t('llmExport.noPreview') }}</p>
      </div>

      <!-- Preview content -->
      <pre
        v-else
        class="p-4 text-sm font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words"
        >{{ content }}</pre
      >

      <!-- Fade overlay at bottom -->
      <div
        v-if="content && lineCount > 15"
        class="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white dark:from-gray-900 to-transparent pointer-events-none"
      ></div>
    </div>

    <!-- Preview note -->
    <div
      v-if="content && lineCount > 15"
      class="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 text-center"
    >
      {{ t('llmExport.previewNote') }}
    </div>
  </div>
</template>
