<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { getTemplateExample } from '@/services/llm-export/format-service'
import type {
  DateFormatOption,
  DateGroupingOption,
  FormatConfig,
  FormatTemplate,
  MediaPlaceholderOption,
} from '@/types'

const props = defineProps<{
  config: FormatConfig
}>()

const emit = defineEmits<{
  update: [config: FormatConfig]
}>()

const { t } = useI18n()

const templates: FormatTemplate[] = ['plain', 'xml', 'json', 'markdown', 'custom']
const dateFormats: DateFormatOption[] = ['short', 'long', 'iso', 'time-only', 'none']
const dateGroupings: DateGroupingOption[] = ['per-message', 'per-day']
const mediaOptions: MediaPlaceholderOption[] = ['bracket', 'emoji', 'skip']

const templateDescription = computed(() =>
  t(`llmExport.templateDescriptions.${props.config.template}`),
)
const templateExample = computed(() => getTemplateExample(props.config.template))

function updateConfig(updates: Partial<FormatConfig>) {
  emit('update', { ...props.config, ...updates })
}

function getTemplateLabel(template: FormatTemplate): string {
  switch (template) {
    case 'xml':
      return 'XML'
    case 'plain':
      return t('llmExport.templates.plain')
    case 'json':
      return 'JSON'
    case 'markdown':
      return 'Markdown'
    case 'custom':
      return t('llmExport.templates.custom')
    default:
      return template
  }
}

function getDateFormatLabel(format: DateFormatOption): string {
  switch (format) {
    case 'short':
      return t('llmExport.dateFormats.short')
    case 'long':
      return t('llmExport.dateFormats.long')
    case 'iso':
      return 'ISO 8601'
    case 'time-only':
      return t('llmExport.dateFormats.timeOnly')
    case 'none':
      return t('llmExport.dateFormats.none')
    default:
      return format
  }
}

function getMediaLabel(option: MediaPlaceholderOption): string {
  switch (option) {
    case 'bracket':
      return t('llmExport.mediaOptions.bracket')
    case 'emoji':
      return t('llmExport.mediaOptions.emoji')
    case 'skip':
      return t('llmExport.mediaOptions.skip')
    default:
      return option
  }
}

function getDateGroupingLabel(option: DateGroupingOption): string {
  switch (option) {
    case 'per-message':
      return t('llmExport.dateGroupings.perMessage')
    case 'per-day':
      return t('llmExport.dateGroupings.perDay')
    default:
      return option
  }
}
</script>

<template>
  <div
    class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 space-y-4"
  >
    <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
      {{ t('llmExport.formatConfig') }}
    </h3>

    <!-- Template selector (always visible) -->
    <div>
      <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
        {{ t('llmExport.template') }}
      </label>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="template in templates"
          :key="template"
          @click="updateConfig({ template })"
          :class="[
            'px-3 py-1.5 text-sm font-medium rounded-md transition-colors duration-100',
            config.template === template
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700',
          ]"
        >
          {{ getTemplateLabel(template) }}
        </button>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
        {{ templateDescription }}
      </p>
    </div>

    <!-- Custom template input -->
    <div v-if="config.template === 'custom'">
      <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
        {{ t('llmExport.customTemplate') }}
      </label>
      <textarea
        :value="config.customTemplate || templateExample"
        @input="updateConfig({ customTemplate: ($event.target as HTMLTextAreaElement).value })"
        rows="4"
        class="w-full px-3 py-2 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
        :placeholder="templateExample"
      ></textarea>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {{ t('llmExport.customTemplateHint') }}
      </p>
    </div>

    <!-- Data inclusion options -->
      <div class="grid grid-cols-2 gap-4">
        <div class="space-y-3">
          <label
            class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-100"
          >
            <input
              type="checkbox"
              :checked="config.includeSenderName"
              @change="
                updateConfig({ includeSenderName: ($event.target as HTMLInputElement).checked })
              "
              class="rounded text-blue-600 focus:ring-blue-500"
            />
            {{ t('llmExport.includeSenderName') }}
          </label>

          <label
            class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-100"
          >
            <input
              type="checkbox"
              :checked="config.includeSenderUsername"
              @change="
                updateConfig({ includeSenderUsername: ($event.target as HTMLInputElement).checked })
              "
              class="rounded text-blue-600 focus:ring-blue-500"
            />
            {{ t('llmExport.includeSenderUsername') }}
          </label>

          <label
            class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-100"
            :title="t('llmExport.useOriginalNamesHint')"
          >
            <input
              type="checkbox"
              :checked="config.useOriginalSenderNames"
              @change="
                updateConfig({
                  useOriginalSenderNames: ($event.target as HTMLInputElement).checked,
                })
              "
              :disabled="!config.includeSenderName"
              class="rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50"
            />
            {{ t('llmExport.useOriginalNames') }}
          </label>

          <label
            class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-100"
          >
            <input
              type="checkbox"
              :checked="config.includeReplyContext"
              @change="
                updateConfig({ includeReplyContext: ($event.target as HTMLInputElement).checked })
              "
              class="rounded text-blue-600 focus:ring-blue-500"
            />
            {{ t('llmExport.includeReplyContext') }}
          </label>
        </div>

        <div class="space-y-3">
          <label
            class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-100"
          >
            <input
              type="checkbox"
              :checked="config.includeDate"
              @change="updateConfig({ includeDate: ($event.target as HTMLInputElement).checked })"
              class="rounded text-blue-600 focus:ring-blue-500"
            />
            {{ t('llmExport.includeDate') }}
          </label>

          <label
            class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-100"
          >
            <input
              type="checkbox"
              :checked="config.includeMessageIds"
              @change="
                updateConfig({ includeMessageIds: ($event.target as HTMLInputElement).checked })
              "
              class="rounded text-blue-600 focus:ring-blue-500"
            />
            {{ t('llmExport.includeMessageIds') }}
          </label>

          <label
            class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-100"
          >
            <input
              type="checkbox"
              :checked="config.reverseOrder"
              @change="updateConfig({ reverseOrder: ($event.target as HTMLInputElement).checked })"
              class="rounded text-blue-600 focus:ring-blue-500"
            />
            {{ t('llmExport.reverseOrder') }}
          </label>
        </div>
      </div>

      <!-- Date format, grouping, and media options -->
      <div class="grid grid-cols-3 gap-4">
        <div>
          <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
            {{ t('llmExport.dateFormat') }}
          </label>
          <select
            :value="config.dateFormat"
            @change="
              updateConfig({
                dateFormat: ($event.target as HTMLSelectElement).value as DateFormatOption,
              })
            "
            :disabled="!config.includeDate"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100 disabled:opacity-50"
          >
            <option v-for="format in dateFormats" :key="format" :value="format">
              {{ getDateFormatLabel(format) }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
            {{ t('llmExport.dateGrouping') }}
          </label>
          <select
            :value="config.dateGrouping"
            @change="
              updateConfig({
                dateGrouping: ($event.target as HTMLSelectElement).value as DateGroupingOption,
              })
            "
            :disabled="!config.includeDate"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100 disabled:opacity-50"
          >
            <option v-for="grouping in dateGroupings" :key="grouping" :value="grouping">
              {{ getDateGroupingLabel(grouping) }}
            </option>
          </select>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {{ t('llmExport.dateGroupingHint') }}
          </p>
        </div>

        <div>
          <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
            {{ t('llmExport.mediaPlaceholder') }}
          </label>
          <select
            :value="config.mediaPlaceholder"
            @change="
              updateConfig({
                mediaPlaceholder: ($event.target as HTMLSelectElement)
                  .value as MediaPlaceholderOption,
              })
            "
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
          >
            <option v-for="option in mediaOptions" :key="option" :value="option">
              {{ getMediaLabel(option) }}
            </option>
          </select>
        </div>
      </div>

      <!-- Message limit -->
      <div>
        <label class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          {{ t('llmExport.outputLimit') }}
        </label>
        <div class="flex items-center gap-3">
          <input
            type="number"
            :value="config.messageLimit"
            @input="
              updateConfig({
                messageLimit: parseInt(($event.target as HTMLInputElement).value) || 0,
              })
            "
            min="0"
            :placeholder="t('llmExport.noLimit')"
            class="w-32 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
          />
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {{ t('llmExport.outputLimitHint') }}
          </span>
        </div>
      </div>
  </div>
</template>
