<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { ChatInfo } from '@/types'

defineProps<{
  chat: ChatInfo
  limit: number
  minDate: string
  maxDate: string
  isSubmitting: boolean
}>()

const emit = defineEmits<{
  'update:limit': [value: number]
  'update:minDate': [value: string]
  'update:maxDate': [value: string]
  start: []
}>()

const { t } = useI18n()

const limitInputId = 'llm-export-download-limit'
const minDateInputId = 'llm-export-download-min-date'
const maxDateInputId = 'llm-export-download-max-date'
</script>

<template>
  <section class="space-y-4">
    <div class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
      <div class="mb-4">
        <p class="text-sm font-semibold text-gray-900 dark:text-white break-words">
          {{ chat.title }}
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {{ chat.type }}
        </p>
      </div>

      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
        {{ t('llmExport.downloadOptions') }}
      </h3>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label
            :for="limitInputId"
            class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
          >
            {{ t('llmExport.messageLimit') }}
          </label>
          <input
            :id="limitInputId"
            :value="limit"
            type="number"
            min="0"
            :placeholder="t('llmExport.noLimit')"
            class="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
            @input="emit('update:limit', Number(($event.target as HTMLInputElement).value || 0))"
          />
        </div>

        <div>
          <label
            :for="minDateInputId"
            class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
          >
            {{ t('llmExport.fromDate') }}
          </label>
          <input
            :id="minDateInputId"
            :value="minDate"
            type="date"
            class="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
            @input="emit('update:minDate', ($event.target as HTMLInputElement).value)"
          />
        </div>

        <div>
          <label
            :for="maxDateInputId"
            class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
          >
            {{ t('llmExport.toDate') }}
          </label>
          <input
            :id="maxDateInputId"
            :value="maxDate"
            type="date"
            class="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
            @input="emit('update:maxDate', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>

      <div class="mt-4 flex justify-start md:justify-end">
        <button
          :disabled="isSubmitting"
          class="px-4 py-2 rounded-md font-medium text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors duration-100"
          @click="emit('start')"
        >
          {{ t('llmExport.startDownload') }}
        </button>
      </div>
    </div>

    <div class="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-900">
      <p class="text-sm font-semibold text-blue-900 dark:text-blue-200">
        {{ t('llmExport.infoTitle') }}
      </p>
      <p class="text-xs text-blue-700 dark:text-blue-300 mt-1">
        {{ t('llmExport.infoDescription') }}
      </p>
    </div>
  </section>
</template>
