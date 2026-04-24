<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import FloodWaitIndicator from '@/components/common/FloodWaitIndicator.vue'
import { formatMessages, formatPreview } from '@/services/llm-export/format-service'
import type { ChatArchiveProgress, ChatExport, ChatMessage, FormatConfig } from '@/types'
import FormatConfigPanel from './FormatConfig.vue'
import LivePreview from './LivePreview.vue'

const props = defineProps<{
  chatExport: ChatExport | null
  messages: ChatMessage[]
  config: FormatConfig
  isLoading: boolean
  isDownloadingArchive: boolean
  archiveProgress: ChatArchiveProgress | null
  archiveStatusText: string
  floodWaitSeconds: number
  floodWaitRemaining: number
  floodWaitProgress: number
}>()

const emit = defineEmits<{
  'update:config': [config: FormatConfig]
  copy: []
  'download-file': []
  'download-zip': []
  'cancel-zip': []
}>()

const { t } = useI18n()

const formattedOutput = computed(() => {
  if (!props.chatExport || props.messages.length === 0) {
    return ''
  }

  return formatMessages(props.messages, props.chatExport, props.config)
})

const previewOutput = computed(() => {
  if (!props.chatExport || props.messages.length === 0) {
    return ''
  }

  return formatPreview(props.messages, props.chatExport, props.config, 15)
})

const outputStats = computed(() => {
  const output = formattedOutput.value
  return {
    characters: output.length,
    lines: output ? output.split('\n').length : 0,
    estimatedTokens: Math.ceil(output.length / 4),
  }
})
</script>

<template>
  <section class="space-y-6">
    <div
      v-if="isLoading && !chatExport"
      class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm"
    >
      <p class="text-sm text-gray-600 dark:text-gray-400">{{ t('common.loading') }}</p>
    </div>

    <template v-else-if="chatExport">
      <FormatConfigPanel :config="config" @update="emit('update:config', $event)" />

      <div class="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex flex-wrap gap-3 text-sm text-gray-600 dark:text-gray-400">
            <span>{{ outputStats.characters.toLocaleString() }} {{ t('llmExport.chars') }}</span>
            <span>{{ outputStats.lines.toLocaleString() }} {{ t('llmExport.lines') }}</span>
            <span>~{{ outputStats.estimatedTokens.toLocaleString() }} {{ t('llmExport.tokens') }}</span>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              class="px-3 py-1.5 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 transition-colors duration-100"
              @click="emit('copy')"
            >
              {{ t('llmExport.copy') }}
            </button>
            <button
              class="px-3 py-1.5 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-100"
              @click="emit('download-file')"
            >
              {{ t('llmExport.download') }}
            </button>
            <button
              :disabled="isDownloadingArchive"
              class="px-3 py-1.5 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors duration-100"
              @click="emit('download-zip')"
            >
              {{ isDownloadingArchive ? t('export.generating') : t('export.downloadZipBtn') }}
            </button>
          </div>
        </div>
      </div>

      <div
        v-if="isDownloadingArchive && archiveProgress"
        class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">
              {{ archiveStatusText }}
            </p>
            <p
              v-if="archiveProgress.totalMediaMessages > 0"
              class="text-xs text-gray-500 dark:text-gray-400 mt-1"
            >
              {{ archiveProgress.processedMediaMessages }} / {{ archiveProgress.totalMediaMessages }}
            </p>
          </div>

          <button
            class="px-3 py-1.5 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-100"
            @click="emit('cancel-zip')"
          >
            {{ t('common.cancel') }}
          </button>
        </div>

        <FloodWaitIndicator
          :seconds="floodWaitSeconds"
          :remaining="floodWaitRemaining"
          :progress="floodWaitProgress"
        />
      </div>

      <LivePreview :content="previewOutput" />
    </template>

    <div
      v-else
      class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 shadow-sm"
    >
      <p class="text-base font-medium text-gray-900 dark:text-white">
        {{ t('llmExport.selectExport') }}
      </p>
      <p class="text-sm mt-1">
        {{ t('llmExport.selectExportDesc') }}
      </p>
    </div>
  </section>
</template>
