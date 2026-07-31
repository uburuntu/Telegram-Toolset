<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatInfo } from '@/types'
import { formatDateWithLocale, formatNumberWithLocale } from '@/utils/locale-format'
import {
  CHAT_CATEGORIES,
  CHAT_SORTS,
  type ChatCategory,
  type ChatSelectorConfig,
  type ChatSelectorLabels,
  type ChatSort,
  countChatsByCategory,
  DEFAULT_CHAT_SELECTOR_DISPLAY,
  DEFAULT_CHAT_SELECTOR_FILTERS,
  filterAndSortChats,
  getChatCategory,
  getEligibleChats,
  isPublicChat,
} from './chat-selector'

const props = withDefaults(
  defineProps<{
    chats: ChatInfo[]
    selectedIds?: ReadonlySet<string> | readonly string[]
    isLoading?: boolean
    error?: string
    config?: ChatSelectorConfig
    labels?: ChatSelectorLabels
    inputId?: string
  }>(),
  {
    selectedIds: () => [],
    isLoading: false,
    error: '',
    config: () => ({}),
    labels: () => ({}),
    inputId: 'chat-selector-search',
  },
)

const emit = defineEmits<{
  select: [chat: ChatInfo]
  toggle: [chat: ChatInfo]
  'set-visible': [chats: ChatInfo[], selected: boolean]
  retry: []
}>()

const { locale, t } = useI18n()

const searchQuery = ref('')
const activeCategories = ref<ChatCategory[]>([])
const publicOnly = ref(false)
const adminOnly = ref(false)
const sendableOnly = ref(false)
const selectedOnly = ref(false)
const sort = ref<ChatSort>('recent')

const mode = computed(() => props.config.mode ?? 'single')
const filterOptions = computed(() => ({
  ...DEFAULT_CHAT_SELECTOR_FILTERS,
  ...props.config.filters,
  selectedOnly: mode.value === 'multiple' && (props.config.filters?.selectedOnly ?? true),
}))
const displayOptions = computed(() => ({
  ...DEFAULT_CHAT_SELECTOR_DISPLAY,
  ...props.config.display,
  selectedCount: mode.value === 'multiple' && (props.config.display?.selectedCount ?? true),
  selectVisible: mode.value === 'multiple' && (props.config.display?.selectVisible ?? true),
}))
const constraints = computed(() => ({
  allowedTypes: props.config.allowedTypes,
  requiredCapabilities: props.config.requiredCapabilities,
}))
const selectedIdSet = computed<ReadonlySet<string>>(() =>
  props.selectedIds instanceof Set ? props.selectedIds : new Set(props.selectedIds),
)
const availableCategories = computed(() => {
  const allowedTypes = props.config.allowedTypes
  if (!allowedTypes) return [...CHAT_CATEGORIES]
  return CHAT_CATEGORIES.filter((category) =>
    allowedTypes.some((type) => getChatCategory({ type }) === category),
  )
})
const categoryConfigurationKey = computed(
  () =>
    `${availableCategories.value.join(',')}|${(props.config.defaultCategories ?? []).join(',')}`,
)

watch(
  categoryConfigurationKey,
  () => {
    const defaults = props.config.defaultCategories ?? availableCategories.value
    activeCategories.value = defaults.filter((category) =>
      availableCategories.value.includes(category),
    )
  },
  { immediate: true },
)

watch(
  () => [props.config.defaultSort, ...(props.config.sortOptions ?? CHAT_SORTS)].join(','),
  () => {
    const options = props.config.sortOptions ?? CHAT_SORTS
    sort.value = options.includes(props.config.defaultSort ?? 'recent')
      ? (props.config.defaultSort ?? 'recent')
      : (options[0] ?? 'recent')
  },
  { immediate: true },
)

const eligibleChats = computed(() => getEligibleChats(props.chats, constraints.value))
const categoryCounts = computed(() => countChatsByCategory(props.chats, constraints.value))
const filteredChats = computed(() =>
  filterAndSortChats(
    props.chats,
    {
      search: searchQuery.value,
      categories: activeCategories.value,
      publicOnly: publicOnly.value,
      adminOnly: adminOnly.value,
      sendableOnly: sendableOnly.value,
      selectedOnly: selectedOnly.value,
      selectedIds: selectedIdSet.value,
      sort: sort.value,
      locale: locale.value,
    },
    constraints.value,
  ),
)
const allVisibleSelected = computed(
  () =>
    filteredChats.value.length > 0 &&
    filteredChats.value.every((chat) => selectedIdSet.value.has(chat.id.toString())),
)
const someVisibleSelected = computed(
  () =>
    !allVisibleSelected.value &&
    filteredChats.value.some((chat) => selectedIdSet.value.has(chat.id.toString())),
)
const selectionLimitReached = computed(
  () =>
    props.config.maxSelections !== undefined &&
    selectedIdSet.value.size >= props.config.maxSelections,
)
const hasUserFilters = computed(
  () =>
    searchQuery.value.length > 0 ||
    activeCategories.value.length !== availableCategories.value.length ||
    publicOnly.value ||
    adminOnly.value ||
    sendableOnly.value ||
    selectedOnly.value ||
    sort.value !== (props.config.defaultSort ?? 'recent'),
)
const sortOptions = computed(() => props.config.sortOptions ?? CHAT_SORTS)
const hasSecondaryFilters = computed(
  () =>
    filterOptions.value.publicOnly ||
    filterOptions.value.adminOnly ||
    filterOptions.value.sendableOnly ||
    filterOptions.value.selectedOnly,
)

const listHeightClass = computed(() => {
  switch (displayOptions.value.maxHeight) {
    case 'sm':
      return 'max-h-72'
    case 'md':
      return 'max-h-[28rem]'
    case 'lg':
      return 'max-h-[36rem]'
  }
})
const rowPaddingClass = computed(() => (displayOptions.value.density === 'compact' ? 'p-2' : 'p-3'))

function resetFilters(): void {
  searchQuery.value = ''
  activeCategories.value = [...availableCategories.value]
  publicOnly.value = false
  adminOnly.value = false
  sendableOnly.value = false
  selectedOnly.value = false
  sort.value = props.config.defaultSort ?? 'recent'
}

function selectVisible(selected: boolean): void {
  if (!selected || props.config.maxSelections === undefined) {
    emit('set-visible', filteredChats.value, selected)
    return
  }

  const remaining = Math.max(0, props.config.maxSelections - selectedIdSet.value.size)
  const chats = filteredChats.value
    .filter((chat) => !selectedIdSet.value.has(chat.id.toString()))
    .slice(0, remaining)
  emit('set-visible', chats, true)
}

function isRowDisabled(chat: ChatInfo): boolean {
  return selectionLimitReached.value && !selectedIdSet.value.has(chat.id.toString())
}

function chatIcon(type: ChatInfo['type']): string {
  switch (type) {
    case 'channel':
      return '📢'
    case 'supergroup':
      return '👥'
    case 'group':
      return '💬'
    case 'user':
      return '👤'
  }
}

function categoryLabel(category: ChatCategory): string {
  return t(`chatSelector.categories.${category}`)
}

function typeLabel(type: ChatInfo['type']): string {
  return t(`chatSelector.types.${type}`)
}

function sortLabel(option: ChatSort): string {
  return t(`chatSelector.sorts.${option}`)
}

function formatDate(date?: Date): string {
  return date ? formatDateWithLocale(date, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}
</script>

<template>
  <section class="space-y-3" :aria-label="labels.title || t('chatSelector.title')">
    <div v-if="labels.title || displayOptions.search" class="space-y-2">
      <label
        v-if="labels.title"
        :for="inputId"
        class="block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {{ labels.title }}
      </label>
      <label v-else :for="inputId" class="sr-only">
        {{ t('chatSelector.search') }}
      </label>
      <div v-if="displayOptions.search" class="relative">
        <input
          :id="inputId"
          v-model="searchQuery"
          type="search"
          :placeholder="labels.searchPlaceholder || t('chatSelector.searchPlaceholder')"
          class="w-full px-3 py-2 pe-20 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
        />
        <button
          v-if="hasUserFilters"
          type="button"
          class="absolute inset-y-1 end-1 px-2 rounded text-xs font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800 focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors duration-100"
          @click="resetFilters"
        >
          {{ t('chatSelector.reset') }}
        </button>
      </div>
    </div>

    <div
      v-if="filterOptions.categories || hasSecondaryFilters || displayOptions.sort"
      class="border-y border-gray-200 dark:border-gray-800 divide-y divide-gray-200 dark:divide-gray-800"
    >
      <div class="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <fieldset v-if="filterOptions.categories" class="flex flex-wrap gap-x-4 gap-y-2">
          <legend class="sr-only">{{ t('chatSelector.chatTypes') }}</legend>
          <label
            v-for="category in availableCategories"
            :key="category"
            class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
          >
            <input
              v-model="activeCategories"
              type="checkbox"
              :value="category"
              class="rounded text-blue-600 focus:ring-blue-500"
            />
            <span>{{ categoryLabel(category) }}</span>
            <span class="text-xs tabular-nums text-gray-400">{{ categoryCounts[category] }}</span>
          </label>
        </fieldset>

        <label
          v-if="displayOptions.sort && sortOptions.length > 1"
          class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 sm:ms-auto"
        >
          <span>{{ t('chatSelector.sortBy') }}</span>
          <select
            v-model="sort"
            class="min-w-32 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option v-for="option in sortOptions" :key="option" :value="option">
              {{ sortLabel(option) }}
            </option>
          </select>
        </label>
      </div>

      <fieldset v-if="hasSecondaryFilters" class="flex flex-wrap gap-x-4 gap-y-2 py-2">
        <legend class="sr-only">{{ t('chatSelector.moreFilters') }}</legend>
        <label
          v-if="filterOptions.publicOnly"
          class="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400"
        >
          <input v-model="publicOnly" type="checkbox" class="rounded text-blue-600 focus:ring-blue-500" />
          {{ t('chatSelector.publicOnly') }}
        </label>
        <label
          v-if="filterOptions.adminOnly"
          class="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400"
        >
          <input v-model="adminOnly" type="checkbox" class="rounded text-blue-600 focus:ring-blue-500" />
          {{ t('chatSelector.adminOnly') }}
        </label>
        <label
          v-if="filterOptions.sendableOnly"
          class="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400"
        >
          <input v-model="sendableOnly" type="checkbox" class="rounded text-blue-600 focus:ring-blue-500" />
          {{ t('chatSelector.sendableOnly') }}
        </label>
        <label
          v-if="filterOptions.selectedOnly"
          class="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400"
        >
          <input v-model="selectedOnly" type="checkbox" class="rounded text-blue-600 focus:ring-blue-500" />
          {{ t('chatSelector.selectedOnly') }}
        </label>
      </fieldset>
    </div>

    <div
      v-if="!isLoading && !error && eligibleChats.length > 0"
      class="flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400"
    >
      <label
        v-if="displayOptions.selectVisible && filteredChats.length > 0"
        class="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
      >
        <input
          type="checkbox"
          :checked="allVisibleSelected"
          :indeterminate="someVisibleSelected"
          class="rounded text-blue-600 focus:ring-blue-500"
          @change="selectVisible(($event.target as HTMLInputElement).checked)"
        />
        {{ t('chatSelector.selectVisible', { count: filteredChats.length }) }}
      </label>
      <span v-if="displayOptions.resultCount" class="tabular-nums">
        {{ t('chatSelector.resultCount', { shown: filteredChats.length, total: eligibleChats.length }) }}
      </span>
      <span v-if="displayOptions.selectedCount" class="tabular-nums">
        {{ t('chatSelector.selectedCount', { count: selectedIdSet.size }) }}
      </span>
    </div>

    <div v-if="isLoading" class="py-12 text-center" role="status">
      <div
        class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"
      ></div>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ labels.loading || t('chatSelector.loading') }}
      </p>
    </div>

    <div v-else-if="error" class="py-8 text-center" role="alert" aria-live="assertive">
      <p class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
      <button
        type="button"
        class="mt-3 px-4 py-2 rounded-md font-medium text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors duration-100"
        @click="emit('retry')"
      >
        {{ labels.retry || t('common.tryAgain') }}
      </button>
    </div>

    <div v-else-if="filteredChats.length === 0" class="py-12 text-center">
      <h3 class="text-sm font-medium text-gray-900 dark:text-white">
        {{
          eligibleChats.length === 0
            ? labels.emptyTitle || t('chatSelector.noChats')
            : labels.noResults || t('chatSelector.noResults')
        }}
      </h3>
      <p
        v-if="eligibleChats.length === 0 && labels.emptyDescription"
        class="mt-1 text-sm text-gray-600 dark:text-gray-400"
      >
        {{ labels.emptyDescription }}
      </p>
    </div>

    <div
      v-else
      :class="[listHeightClass, 'overflow-y-auto border-y border-gray-200 dark:border-gray-800']"
    >
      <component
        :is="mode === 'multiple' ? 'label' : 'button'"
        v-for="chat in filteredChats"
        :key="chat.peerId || chat.id.toString()"
        :type="mode === 'single' ? 'button' : undefined"
        :disabled="mode === 'single' ? isRowDisabled(chat) : undefined"
        :aria-pressed="mode === 'single' ? selectedIdSet.has(chat.id.toString()) : undefined"
        :class="[
          rowPaddingClass,
          'flex w-full items-start gap-3 border-b last:border-b-0 border-gray-100 dark:border-gray-800 text-left transition-colors duration-100',
          selectedIdSet.has(chat.id.toString())
            ? 'bg-blue-50 dark:bg-blue-950/40'
            : 'bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/60',
          isRowDisabled(chat) ? 'opacity-50' : '',
        ]"
        @click="mode === 'single' && !isRowDisabled(chat) ? emit('select', chat) : undefined"
      >
        <input
          v-if="mode === 'multiple'"
          type="checkbox"
          :checked="selectedIdSet.has(chat.id.toString())"
          :disabled="isRowDisabled(chat)"
          class="mt-3 rounded text-blue-600 focus:ring-blue-500"
          @change="emit('toggle', chat)"
        />
        <span
          class="w-9 h-9 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg text-lg shrink-0"
          aria-hidden="true"
        >
          {{ chatIcon(chat.type) }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium text-gray-900 dark:text-white break-words">
            {{ chat.title }}
          </span>
          <span class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span>{{ typeLabel(chat.type) }}</span>
            <span v-if="displayOptions.username && chat.username" class="break-all">
              · @{{ chat.username }}
            </span>
            <span v-if="displayOptions.lastActivity && chat.lastMessageDate">
              · {{ formatDate(chat.lastMessageDate) }}
            </span>
            <span v-if="displayOptions.participants && chat.participantCount !== undefined">
              ·
              {{
                t('chatSelector.members', {
                  count: formatNumberWithLocale(chat.participantCount),
                })
              }}
            </span>
          </span>
          <span v-if="displayOptions.badges" class="mt-1.5 flex flex-wrap gap-1.5">
            <span
              v-if="isPublicChat(chat)"
              class="px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-gray-300"
            >
              {{ t('chatSelector.publicBadge') }}
            </span>
            <span
              v-if="chat.isAdmin"
              class="px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-950/50 text-xs text-green-700 dark:text-green-300"
            >
              {{ t('common.admin') }}
            </span>
          </span>
        </span>
        <span
          v-if="mode === 'single' && selectedIdSet.has(chat.id.toString())"
          class="mt-2 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          ✓
        </span>
      </component>
    </div>
  </section>
</template>
