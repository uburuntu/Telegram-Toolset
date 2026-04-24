<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatInfo } from '@/types'

const props = defineProps<{
  chats: ChatInfo[]
  isLoading: boolean
  selectedChat: ChatInfo | null
}>()

const emit = defineEmits<{
  select: [chat: ChatInfo]
}>()

const { t } = useI18n()

const searchQuery = ref('')
const searchInputId = 'llm-export-chat-search'

const filteredChats = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return props.chats
  }

  return props.chats.filter((chat) => {
    const haystack = [chat.title, chat.username ? `@${chat.username}` : ''].join(' ').toLowerCase()
    return haystack.includes(query)
  })
})

function getChatIcon(type: ChatInfo['type']): string {
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

function formatDate(date?: Date): string {
  if (!date) {
    return ''
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
</script>

<template>
  <section class="space-y-4">
    <div>
      <label
        :for="searchInputId"
        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
      >
        {{ t('llmExport.selectChat') }}
      </label>
      <input
        :id="searchInputId"
        v-model="searchQuery"
        type="search"
        :placeholder="t('llmExport.searchChats')"
        class="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors duration-100"
      />
    </div>

    <div v-if="isLoading" class="text-center py-12">
      <div class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
      <p class="text-gray-600 dark:text-gray-400">{{ t('llmExport.loadingChats') }}</p>
    </div>

    <div v-else-if="filteredChats.length === 0" class="text-center py-12">
      <p class="text-gray-600 dark:text-gray-400">
        {{ searchQuery ? t('llmExport.noChatsFound') : t('llmExport.noChats') }}
      </p>
    </div>

    <div v-else class="space-y-2 max-h-[28rem] overflow-y-auto">
      <button
        v-for="chat in filteredChats"
        :key="chat.peerId || chat.id.toString()"
        :class="[
          'flex items-start gap-3 w-full p-3 rounded-lg border text-left shadow-sm transition-colors duration-100',
          selectedChat?.id === chat.id
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
            : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700',
        ]"
        @click="emit('select', chat)"
      >
        <div class="w-10 h-10 flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg text-xl flex-shrink-0">
          {{ getChatIcon(chat.type) }}
        </div>

        <div class="flex-1 min-w-0">
          <div class="font-medium text-gray-900 dark:text-white break-words">
            {{ chat.title }}
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400 mt-1 break-words">
            <span>{{ chat.type }}</span>
            <span v-if="chat.username"> · @{{ chat.username }}</span>
            <span v-if="chat.lastMessageDate"> · {{ formatDate(chat.lastMessageDate) }}</span>
          </div>
        </div>

        <div
          v-if="selectedChat?.id === chat.id"
          class="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0"
        >
          <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
        </div>
      </button>
    </div>
  </section>
</template>
