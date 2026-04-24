<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ChatExport } from '@/types'

const props = defineProps<{
  exports: ChatExport[]
  selectedExportId?: string
  isLoadingList: boolean
  isLoadingSelection: boolean
  errorMessage?: string
}>()

const emit = defineEmits<{
  select: [chatExport: ChatExport]
  delete: [exportId: string]
}>()

const { t } = useI18n()

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function formatDateRange(range: { from: Date; to: Date }): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return `${formatter.format(range.from)} - ${formatter.format(range.to)}`
}

function getChatIcon(type: ChatExport['chatType']): string {
  switch (type) {
    case 'channel':
      return '📢'
    case 'supergroup':
      return '👥'
    case 'group':
      return '💬'
    case 'user':
      return '👤'
    default:
      return '💬'
  }
}

function handleDelete(exportId: string) {
  if (confirm(t('llmExport.confirmDelete'))) {
    emit('delete', exportId)
  }
}
</script>

<template>
  <section class="space-y-3">
    <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
      {{ t('llmExport.cachedExports') }}
    </h3>

    <div v-if="isLoadingList" class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
      <div class="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full"></div>
    </div>

    <div
      v-else-if="errorMessage"
      class="p-4 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300"
    >
      {{ errorMessage }}
    </div>

    <div
      v-else-if="props.exports.length === 0"
      class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm text-gray-500 dark:text-gray-400"
    >
      <p class="text-sm">{{ t('llmExport.noExports') }}</p>
      <p class="text-xs mt-1">{{ t('llmExport.noExportsHint') }}</p>
    </div>

    <div v-else class="space-y-2">
      <article
        v-for="chatExport in props.exports"
        :key="chatExport.id"
        class="p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <div class="flex items-start gap-3">
          <button
            class="flex flex-1 items-start gap-3 text-left"
            :class="selectedExportId === chatExport.id ? 'text-blue-700 dark:text-blue-300' : ''"
            @click="emit('select', chatExport)"
          >
            <div class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg text-lg flex-shrink-0">
              {{ getChatIcon(chatExport.chatType) }}
            </div>

            <div class="min-w-0 flex-1">
              <div class="font-medium text-sm text-gray-900 dark:text-white break-words">
                {{ chatExport.chatTitle }}
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-1 break-words">
                <span>{{ chatExport.messageCount.toLocaleString() }} {{ t('llmExport.messages') }}</span>
                <span v-if="(chatExport.mediaCount ?? 0) > 0">
                  · {{ t('export.mediaFiles', { count: chatExport.mediaCount ?? 0 }) }}
                </span>
              </div>
              <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {{ formatDateRange(chatExport.dateRange) }}
              </div>
              <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {{ t('llmExport.exported') }} {{ formatDate(chatExport.createdAt) }}
              </div>
              <div
                v-if="isLoadingSelection && selectedExportId === chatExport.id"
                class="text-xs text-blue-600 dark:text-blue-300 mt-2"
              >
                {{ t('common.loading') }}
              </div>
            </div>
          </button>

          <button
            class="px-2 py-1.5 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-300 transition-colors duration-100"
            :title="t('common.delete')"
            @click="handleDelete(chatExport.id)"
          >
            {{ t('common.delete') }}
          </button>
        </div>
      </article>
    </div>
  </section>
</template>
