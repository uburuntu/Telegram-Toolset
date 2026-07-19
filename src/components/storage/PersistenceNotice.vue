<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePersistenceStatus } from '@/composables'

const { t } = useI18n()
const { status, refresh } = usePersistenceStatus()

onMounted(() => {
  void refresh()
})

// Only warn when durability is not guaranteed. A persisted origin needs no notice.
const shouldShow = computed(() => status.value !== 'persisted')
const title = computed(() =>
  status.value === 'unsupported'
    ? t('persistence.unsupportedTitle')
    : t('persistence.bestEffortTitle'),
)
</script>

<template>
  <div
    v-if="shouldShow"
    class="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-900 mb-6"
    role="status"
  >
    <h2 class="text-base font-medium text-amber-900 dark:text-amber-100">{{ title }}</h2>
    <p class="text-sm text-amber-800 dark:text-amber-200 mt-1">{{ t('persistence.body') }}</p>
  </div>
</template>
