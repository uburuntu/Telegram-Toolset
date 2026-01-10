<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ChatExport } from '@/types'

defineProps<{
  exports: ChatExport[]
  selectedExportId?: string
  isLoading: boolean
}>()

const emit = defineEmits<{
  select: [chatExport: ChatExport]
  delete: [exportId: string]
}>()

const { t } = useI18n()

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function formatDateRange(range: { from: Date; to: Date }): string {
  const formatOpts: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }
  const from = new Intl.DateTimeFormat('en-US', formatOpts).format(range.from)
  const to = new Intl.DateTimeFormat('en-US', formatOpts).format(range.to)
  return `${from} - ${to}`
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

function handleDelete(e: Event, exportId: string) {
  e.stopPropagation()
  if (confirm(t('llmExport.confirmDelete'))) {
    emit('delete', exportId)
  }
}
</script>

<template>
  <div class="space-y-3">
    <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
      {{ t('llmExport.cachedExports') }}
    </h3>

    <!-- Loading state -->
    <div v-if="isLoading" class="text-center py-8">
      <div
        class="animate-spin w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full mx-auto"
      ></div>
    </div>

    <!-- Empty state -->
    <div v-else-if="exports.length === 0" class="text-center py-8 text-gray-500 dark:text-gray-400">
      <div class="text-3xl mb-2">📭</div>
      <p class="text-sm">{{ t('llmExport.noExports') }}</p>
      <p class="text-xs mt-1">{{ t('llmExport.noExportsHint') }}</p>
    </div>

    <!-- Exports list -->
    <div v-else class="space-y-2">
      <button
        v-for="exp in exports"
        :key="exp.id"
        @click="emit('select', exp)"
        :class="[
          'w-full p-3 rounded-lg border transition-all duration-100 text-left group',
          selectedExportId === exp.id
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700',
        ]"
      >
        <div class="flex items-start gap-3">
          <div
            class="w-8 h-8 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg text-lg flex-shrink-0"
          >
            {{ getChatIcon(exp.chatType) }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-sm text-gray-900 dark:text-white truncate">
              {{ exp.chatTitle }}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {{ exp.messageCount.toLocaleString() }} {{ t('llmExport.messages') }}
            </div>
            <div class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {{ formatDateRange(exp.dateRange) }}
            </div>
          </div>
          <button
            @click="(e) => handleDelete(e, exp.id)"
            class="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all duration-100 flex-shrink-0"
            :title="t('common.delete')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
        <div class="text-xs text-gray-400 dark:text-gray-500 mt-2">
          {{ t('llmExport.exported') }} {{ formatDate(exp.createdAt) }}
        </div>
      </button>
    </div>
  </div>
</template>
