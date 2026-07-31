<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TraceChatScan } from '@/services/delete-trace/delete-trace-service'
import { formatDateWithLocale, formatNumberWithLocale } from '@/utils/locale-format'

const props = defineProps<{
  scans: TraceChatScan[]
}>()

const { t } = useI18n()

const totalMessages = computed(() =>
  props.scans.reduce((total, scan) => total + scan.messageIds.length, 0),
)

const previewedMessages = computed(() =>
  props.scans.reduce((total, scan) => total + scan.messages.length, 0),
)

const preview = computed(() =>
  props.scans
    .map((scan) => {
      const messages = [...scan.messages].sort(
        (left, right) => right.date.getTime() - left.date.getTime(),
      )

      if (messages.length === 0) return ''

      const entries = messages.map(
        (message) =>
          `[${formatTimestamp(message.date)}]\n${
            message.preview.kind === 'text'
              ? message.preview.text
              : `[${t('deleteTrace.nonTextMessage')}]`
          }`,
      )
      return `=== ${scan.chat.title} ===\n\n${entries.join('\n\n')}`
    })
    .filter(Boolean)
    .join('\n\n\n'),
)

function formatTimestamp(date: Date): string {
  return formatDateWithLocale(date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
</script>

<template>
  <section
    class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
    :aria-label="t('deleteTrace.previewTitle')"
  >
    <div
      class="flex flex-col gap-1 border-b border-gray-200 bg-gray-50 px-4 py-2 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800 dark:bg-gray-950"
    >
      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
        {{ t('deleteTrace.previewTitle') }}
      </h3>
      <span class="text-xs text-gray-500 dark:text-gray-400">
        {{
          t('deleteTrace.previewCount', {
            shown: formatNumberWithLocale(previewedMessages),
            total: formatNumberWithLocale(totalMessages),
          })
        }}
      </span>
    </div>

    <pre
      v-if="preview"
      class="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-sm text-gray-800 dark:text-gray-200"
    >{{ preview }}</pre>

    <div v-else class="flex items-center justify-center px-4 py-12 text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t('deleteTrace.noTextPreview') }}
      </p>
    </div>
  </section>
</template>
