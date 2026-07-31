<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatInfo } from '@/types'
import { formatDateWithLocale } from '@/utils/locale-format'

const props = defineProps<{
  chats: ChatInfo[]
  selectedIds: ReadonlySet<string>
  isLoading: boolean
}>()

const emit = defineEmits<{
  toggle: [chat: ChatInfo]
  'set-visible': [chats: ChatInfo[], selected: boolean]
}>()

const { t } = useI18n()
const searchQuery = ref('')

const filteredChats = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return props.chats

  return props.chats.filter((chat) =>
    [chat.title, chat.username ? `@${chat.username}` : '', chat.type]
      .join(' ')
      .toLowerCase()
      .includes(query),
  )
})

const allVisibleSelected = computed(
  () =>
    filteredChats.value.length > 0 &&
    filteredChats.value.every((chat) => props.selectedIds.has(chat.id.toString())),
)

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

function formatDate(date?: Date): string {
  return date ? formatDateWithLocale(date, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}
</script>

<template>
  <section class="space-y-3" :aria-label="t('deleteTrace.selectChats')">
    <div>
      <label
        for="delete-trace-chat-search"
        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
      >
        {{ t('deleteTrace.selectChats') }}
      </label>
      <input
        id="delete-trace-chat-search"
        v-model="searchQuery"
        type="search"
        :placeholder="t('deleteTrace.searchChats')"
        class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
      />
    </div>

    <div
      v-if="!isLoading && filteredChats.length > 0"
      class="flex flex-wrap items-center justify-between gap-3 border-y border-gray-200 dark:border-gray-800 py-2"
    >
      <label class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          :checked="allVisibleSelected"
          class="rounded text-blue-600 focus:ring-blue-500"
          @change="
            emit(
              'set-visible',
              filteredChats,
              ($event.target as HTMLInputElement).checked,
            )
          "
        />
        {{ t('deleteTrace.selectVisible', { count: filteredChats.length }) }}
      </label>
      <span class="text-xs text-gray-500 dark:text-gray-400">
        {{ t('deleteTrace.selectedCount', { count: selectedIds.size }) }}
      </span>
    </div>

    <div v-if="isLoading" class="py-12 text-center" role="status">
      <div
        class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-3"
      ></div>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ t('deleteTrace.loadingChats') }}
      </p>
    </div>

    <div v-else-if="filteredChats.length === 0" class="py-12 text-center">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ searchQuery ? t('deleteTrace.noSearchResults') : t('deleteTrace.noChats') }}
      </p>
    </div>

    <div v-else class="max-h-[32rem] overflow-y-auto border-y border-gray-200 dark:border-gray-800">
      <label
        v-for="chat in filteredChats"
        :key="chat.peerId || chat.id.toString()"
        class="flex items-start gap-3 p-3 border-b last:border-b-0 border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 transition-colors duration-100 hover:bg-gray-50 dark:hover:bg-gray-800/60"
      >
        <input
          type="checkbox"
          :checked="selectedIds.has(chat.id.toString())"
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
          <span class="block mt-1 text-xs text-gray-500 dark:text-gray-400 break-words">
            {{ chat.type }}
            <template v-if="chat.username"> · @{{ chat.username }}</template>
            <template v-if="chat.lastMessageDate"> · {{ formatDate(chat.lastMessageDate) }}</template>
          </span>
        </span>
      </label>
    </div>
  </section>
</template>
