<script setup lang="ts">
import { ref, computed } from 'vue'
import { i18n, setLocale, type SupportedLocale } from '@/i18n'

const isOpen = ref(false)

const languages: { code: SupportedLocale; flag: string }[] = [
  { code: 'en', flag: '🇺🇸' },
  { code: 'ru', flag: '🇷🇺' },
]

// Use i18n.global.locale directly for proper reactivity
const currentLocale = computed(() => i18n.global.locale.value as SupportedLocale)

const currentLanguage = computed(() => {
  const found = languages.find((l) => l.code === currentLocale.value)
  return found ?? { code: 'en' as SupportedLocale, flag: '🇺🇸' }
})

function toggleDropdown(): void {
  isOpen.value = !isOpen.value
}

function closeDropdown(): void {
  isOpen.value = false
}

function switchLanguage(code: SupportedLocale): void {
  setLocale(code)
  closeDropdown()
}

// Get translated language name
function getLanguageName(code: SupportedLocale): string {
  return code === 'en' ? 'English' : 'Русский'
}
</script>

<template>
  <div class="relative">
    <button
      @click="toggleDropdown"
      class="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-100 text-sm"
    >
      <span>{{ currentLanguage.flag }}</span>
      <span class="text-gray-600 dark:text-gray-400 hidden sm:inline">{{
        getLanguageName(currentLanguage.code)
      }}</span>
      <svg
        class="w-3 h-3 text-gray-400 transition-transform duration-100"
        :class="{ 'rotate-180': isOpen }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <!-- Dropdown -->
    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="isOpen"
        class="absolute right-0 mt-1 py-1 bg-white dark:bg-gray-900 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-[120px]"
      >
        <button
          v-for="lang in languages"
          :key="lang.code"
          @click="switchLanguage(lang.code)"
          :class="[
            'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors duration-100',
            lang.code === currentLocale
              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
          ]"
        >
          <span>{{ lang.flag }}</span>
          <span>{{ getLanguageName(lang.code) }}</span>
        </button>
      </div>
    </Transition>

    <!-- Click outside to close -->
    <div v-if="isOpen" class="fixed inset-0 z-40" @click="closeDropdown"></div>
  </div>
</template>
