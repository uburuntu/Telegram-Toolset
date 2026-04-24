<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
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
const customTemplateInput = ref(props.config.customTemplate ?? '')

let customTemplateTimeout: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.config.customTemplate,
  (value) => {
    const normalized = value ?? ''
    if (normalized !== customTemplateInput.value) {
      customTemplateInput.value = normalized
    }
  },
)

onBeforeUnmount(() => {
  if (customTemplateTimeout) {
    clearTimeout(customTemplateTimeout)
  }
})

function updateConfig(updates: Partial<FormatConfig>) {
  emit('update', { ...props.config, ...updates })
}

function updateCustomTemplate(value: string) {
  customTemplateInput.value = value

  if (customTemplateTimeout) {
    clearTimeout(customTemplateTimeout)
  }

  customTemplateTimeout = setTimeout(() => {
    updateConfig({ customTemplate: value })
  }, 120)
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

function getDateGroupingLabel(grouping: DateGroupingOption): string {
  switch (grouping) {
    case 'per-message':
      return t('llmExport.dateGroupings.perMessage')
    case 'per-day':
      return t('llmExport.dateGroupings.perDay')
    default:
      return grouping
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
</script>

<template>
  <section class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm space-y-4">
    <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
      {{ t('llmExport.formatConfig') }}
    </h3>

    <div>
      <p class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
        {{ t('llmExport.template') }}
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="template in templates"
          :key="template"
          class="px-3 py-1.5 rounded-md font-medium text-sm transition-colors duration-100"
          :class="
            config.template === template
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
          "
          @click="updateConfig({ template })"
        >
          {{ getTemplateLabel(template) }}
        </button>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
        {{ templateDescription }}
      </p>
    </div>

    <div v-if="config.template === 'custom'">
      <label
        for="llm-export-custom-template"
        class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2"
      >
        {{ t('llmExport.customTemplate') }}
      </label>
      <textarea
        id="llm-export-custom-template"
        :value="customTemplateInput"
        rows="6"
        class="w-full px-3 py-2 text-sm font-mono rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
        :placeholder="templateExample"
        @input="updateCustomTemplate(($event.target as HTMLTextAreaElement).value)"
      ></textarea>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {{ t('llmExport.customTemplateHint') }}
      </p>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <fieldset class="space-y-3">
        <legend class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Content</legend>

        <label for="llm-export-sender-name" class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            id="llm-export-sender-name"
            :checked="config.includeSenderName"
            type="checkbox"
            class="rounded text-blue-600 focus:ring-blue-500"
            @change="updateConfig({ includeSenderName: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('llmExport.includeSenderName') }}
        </label>

        <label for="llm-export-sender-username" class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            id="llm-export-sender-username"
            :checked="config.includeSenderUsername"
            type="checkbox"
            class="rounded text-blue-600 focus:ring-blue-500"
            @change="updateConfig({ includeSenderUsername: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('llmExport.includeSenderUsername') }}
        </label>

        <label
          for="llm-export-original-names"
          class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
          :title="t('llmExport.useOriginalNamesHint')"
        >
          <input
            id="llm-export-original-names"
            :checked="config.useOriginalSenderNames"
            :disabled="!config.includeSenderName"
            type="checkbox"
            class="rounded text-blue-600 focus:ring-blue-500 disabled:opacity-50"
            @change="
              updateConfig({
                useOriginalSenderNames: ($event.target as HTMLInputElement).checked,
              })
            "
          />
          {{ t('llmExport.useOriginalNames') }}
        </label>

        <label for="llm-export-reply-context" class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            id="llm-export-reply-context"
            :checked="config.includeReplyContext"
            type="checkbox"
            class="rounded text-blue-600 focus:ring-blue-500"
            @change="updateConfig({ includeReplyContext: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('llmExport.includeReplyContext') }}
        </label>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Structure</legend>

        <label for="llm-export-include-date" class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            id="llm-export-include-date"
            :checked="config.includeDate"
            type="checkbox"
            class="rounded text-blue-600 focus:ring-blue-500"
            @change="updateConfig({ includeDate: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('llmExport.includeDate') }}
        </label>

        <label for="llm-export-message-ids" class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            id="llm-export-message-ids"
            :checked="config.includeMessageIds"
            type="checkbox"
            class="rounded text-blue-600 focus:ring-blue-500"
            @change="updateConfig({ includeMessageIds: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('llmExport.includeMessageIds') }}
        </label>

        <label for="llm-export-reverse-order" class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            id="llm-export-reverse-order"
            :checked="config.reverseOrder"
            type="checkbox"
            class="rounded text-blue-600 focus:ring-blue-500"
            @change="updateConfig({ reverseOrder: ($event.target as HTMLInputElement).checked })"
          />
          {{ t('llmExport.reverseOrder') }}
        </label>
      </fieldset>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div>
        <label for="llm-export-date-format" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          {{ t('llmExport.dateFormat') }}
        </label>
        <select
          id="llm-export-date-format"
          :value="config.dateFormat"
          :disabled="!config.includeDate"
          class="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100 disabled:opacity-50"
          @change="
            updateConfig({
              dateFormat: ($event.target as HTMLSelectElement).value as DateFormatOption,
            })
          "
        >
          <option v-for="format in dateFormats" :key="format" :value="format">
            {{ getDateFormatLabel(format) }}
          </option>
        </select>
      </div>

      <div>
        <label for="llm-export-date-grouping" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          {{ t('llmExport.dateGrouping') }}
        </label>
        <select
          id="llm-export-date-grouping"
          :value="config.dateGrouping"
          :disabled="!config.includeDate"
          class="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100 disabled:opacity-50"
          @change="
            updateConfig({
              dateGrouping: ($event.target as HTMLSelectElement).value as DateGroupingOption,
            })
          "
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
        <label for="llm-export-media-placeholder" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          {{ t('llmExport.mediaPlaceholder') }}
        </label>
        <select
          id="llm-export-media-placeholder"
          :value="config.mediaPlaceholder"
          class="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
          @change="
            updateConfig({
              mediaPlaceholder: ($event.target as HTMLSelectElement).value as MediaPlaceholderOption,
            })
          "
        >
          <option v-for="option in mediaOptions" :key="option" :value="option">
            {{ getMediaLabel(option) }}
          </option>
        </select>
      </div>
    </div>

    <div>
      <label for="llm-export-output-limit" class="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
        {{ t('llmExport.outputLimit') }}
      </label>
      <input
        id="llm-export-output-limit"
        :value="config.messageLimit"
        type="number"
        min="0"
        :placeholder="t('llmExport.noLimit')"
        class="w-full px-3 py-2 text-sm rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
        @input="updateConfig({ messageLimit: Number(($event.target as HTMLInputElement).value || 0) })"
      />
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
        {{ t('llmExport.outputLimitHint') }}
      </p>
    </div>
  </section>
</template>
