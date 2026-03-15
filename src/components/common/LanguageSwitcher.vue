<script setup lang="ts">
import { computed, ref } from 'vue'
import { i18n, type SupportedLocale, setLocale } from '@/i18n'

const isOpen = ref(false)

const languages: { code: SupportedLocale; flag: string; name: string }[] = [
  { code: 'id', flag: '🇮🇩', name: 'Bahasa Indonesia' },
  { code: 'en', flag: '🇬🇧', name: 'English' },
  { code: 'es', flag: '🇪🇸', name: 'Español' },
  { code: 'uz', flag: '🇺🇿', name: 'Oʻzbek' },
  { code: 'pt', flag: '🇵🇹', name: 'Português' },
  { code: 'tr', flag: '🇹🇷', name: 'Türkçe' },
  { code: 'ru', flag: '🇷🇺', name: 'Русский' },
  { code: 'uk', flag: '🇺🇦', name: 'Українська' },
  { code: 'ar', flag: '🇸🇦', name: 'العربية' },
  { code: 'fa', flag: '🇮🇷', name: 'فارسی' },
]

// Use i18n.global.locale directly for proper reactivity
const currentLocale = computed(() => i18n.global.locale.value as SupportedLocale)

const currentLanguage = computed<{ code: SupportedLocale; flag: string; name: string }>(() => {
  const found = languages.find((l) => l.code === currentLocale.value)
  return found || languages[0]!
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
</script>

<template>
  <div class="relative">
    <button
      @click="toggleDropdown"
      class="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-100 text-sm"
    >
      <span>{{ currentLanguage.flag }}</span>
      <span class="text-gray-600 dark:text-gray-400 hidden sm:inline">{{
        currentLanguage.name
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
        class="absolute right-0 mt-1 py-1 bg-white dark:bg-gray-900 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 z-50 min-w-[160px] w-max"
      >
        <button
          v-for="lang in languages"
          :key="lang.code"
          @click="switchLanguage(lang.code)"
          :class="[
            'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors duration-100 whitespace-nowrap text-left',
            lang.code === currentLocale
              ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
          ]"
        >
          <span class="text-base">{{ lang.flag }}</span>
          <span>{{ lang.name }}</span>
        </button>
      </div>
    </Transition>

    <!-- Click outside to close -->
    <div v-if="isOpen" class="fixed inset-0 z-40" @click="closeDropdown"></div>
  </div>
</template>
