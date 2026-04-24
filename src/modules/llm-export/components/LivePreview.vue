<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  content: string
}>()

const { t } = useI18n()

const lineCount = computed(() => (props.content ? props.content.split('\n').length : 0))
</script>

<template>
  <section class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
    <div class="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800">
      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
        {{ t('llmExport.preview') }}
      </h3>
      <span class="text-xs text-gray-500 dark:text-gray-400">
        {{ lineCount }} {{ t('llmExport.lines') }}
      </span>
    </div>

    <div
      v-if="!content"
      class="flex items-center justify-center py-16 text-gray-400 dark:text-gray-500"
    >
      <p class="text-sm">{{ t('llmExport.noPreview') }}</p>
    </div>

    <template v-else>
      <pre
        class="p-4 text-sm font-mono text-gray-800 dark:text-gray-200 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words"
      >{{ content }}</pre>

      <div
        v-if="lineCount > 15"
        class="px-4 py-2 bg-gray-50 dark:bg-gray-950 border-t border-gray-200 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400"
      >
        {{ t('llmExport.previewNote') }}
      </div>
    </template>
  </section>
</template>
