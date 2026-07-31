<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AccountSessionIssue } from '@/stores/accounts'

const props = defineProps<{
  name: string
  issue?: AccountSessionIssue
}>()

const emit = defineEmits<{
  reconnect: []
}>()

const { t } = useI18n()
const accountName = computed(() => props.name.trim() || t('accounts.userAccount'))
const titleKey = computed(() =>
  props.issue === 'incompatible' ? 'accounts.sessionUpgradeTitle' : 'accounts.sessionExpiredTitle',
)
const descriptionKey = computed(() =>
  props.issue === 'incompatible'
    ? 'accounts.sessionUpgradeDescription'
    : 'accounts.sessionExpiredDescription',
)
</script>

<template>
  <section
    role="alert"
    aria-live="polite"
    class="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40"
  >
    <div
      class="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
    >
      <div class="min-w-0">
        <p class="text-sm font-medium text-amber-900 dark:text-amber-100">
          {{ t(titleKey, { name: accountName }) }}
        </p>
        <p class="text-sm text-amber-800 dark:text-amber-200">
          {{ t(descriptionKey) }}
        </p>
      </div>
      <button
        class="px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-amber-600 text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 self-start lg:self-auto"
        @click="emit('reconnect')"
      >
        {{ t('accounts.logInAgain') }}
      </button>
    </div>
  </section>
</template>
