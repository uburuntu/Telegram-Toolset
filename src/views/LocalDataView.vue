<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  deleteLocalRecord,
  getLocalDataInventory,
  type LocalDataRecord,
  purgeRetainedLocalData,
} from '@/services/storage/local-data-service'
import { useAccountsStore, useUiStore } from '@/stores'
import { formatBytesWithLocale, formatDateWithLocale } from '@/utils/locale-format'

const { t } = useI18n()
const accountsStore = useAccountsStore()
const uiStore = useUiStore()

const records = ref<LocalDataRecord[]>([])
const totalSizeBytes = ref(0)
const isLoading = ref(true)
const loadError = ref('')
const busy = ref(false)

const hasCredentials = computed(() => accountsStore.apiCredentials !== null)
const hasRecords = computed(() => records.value.length > 0)

async function loadInventory(): Promise<void> {
  isLoading.value = true
  loadError.value = ''
  try {
    const inventory = await getLocalDataInventory()
    records.value = inventory.records
    totalSizeBytes.value = inventory.totalSizeBytes
  } catch (error) {
    console.error('Failed to load local data inventory:', error)
    loadError.value = error instanceof Error ? error.message : t('common.error')
  } finally {
    isLoading.value = false
  }
}

onMounted(loadInventory)

function formatDate(date: Date): string {
  return formatDateWithLocale(date, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatBytes(bytes: number): string {
  return formatBytesWithLocale(bytes)
}

function kindLabel(record: LocalDataRecord): string {
  return record.kind === 'backup' ? t('localData.kindBackup') : t('localData.kindExport')
}

function stateLabel(record: LocalDataRecord): string {
  if (record.health === 'quarantined') return t('localData.state.quarantined')
  if (record.lifecycle === 'archived') return t('localData.state.archived')
  return t('localData.state.legacy')
}

function stateClass(record: LocalDataRecord): string {
  if (record.health === 'quarantined') {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
  }
  if (record.lifecycle === 'archived') {
    return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
  }
  return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200'
}

function reasonLabel(record: LocalDataRecord): string {
  if (record.health === 'quarantined' && record.quarantineReason) {
    return t(`localData.reason.${record.quarantineReason}`)
  }
  if (record.lifecycle === 'archived' && record.archivedReason) {
    return t(`localData.reason.${record.archivedReason}`)
  }
  if (record.verification === 'legacy') {
    return t('localData.reason.legacy')
  }
  return ''
}

async function handleDelete(record: LocalDataRecord): Promise<void> {
  if (busy.value) return
  if (!confirm(t('localData.deleteConfirm'))) return

  busy.value = true
  try {
    await deleteLocalRecord(record)
    uiStore.showToast('success', t('localData.deleteDone'))
    await loadInventory()
  } catch (error) {
    console.error('Failed to delete local record:', error)
    uiStore.showToast('error', error instanceof Error ? error.message : t('common.error'))
  } finally {
    busy.value = false
  }
}

async function handlePurge(): Promise<void> {
  if (busy.value || !hasRecords.value) return
  const message = t('localData.purgeConfirm', {
    count: records.value.length,
    size: formatBytes(totalSizeBytes.value),
  })
  if (!confirm(message)) return

  busy.value = true
  try {
    const summary = await purgeRetainedLocalData()
    uiStore.showToast(
      'success',
      t('localData.purgeDone', { count: summary.backups + summary.chatExports }),
    )
    await loadInventory()
  } catch (error) {
    console.error('Failed to purge local data:', error)
    uiStore.showToast('error', error instanceof Error ? error.message : t('common.error'))
  } finally {
    busy.value = false
  }
}

async function handleClearCredentials(): Promise<void> {
  if (busy.value || !hasCredentials.value) return
  if (!confirm(t('localData.clearCredentialsConfirm'))) return

  busy.value = true
  try {
    await accountsStore.clearApiCredentials()
    uiStore.showToast('success', t('localData.clearCredentialsDone'))
  } catch (error) {
    console.error('Failed to clear credentials:', error)
    uiStore.showToast('error', error instanceof Error ? error.message : t('common.error'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <header class="mb-6">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('localData.title') }}</h1>
      <p class="text-gray-600 dark:text-gray-400 text-sm mt-1">
        {{ t('localData.description') }}
      </p>
    </header>

    <div v-if="isLoading" class="text-center py-12">
      <div
        class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
      ></div>
      <p class="text-gray-600 dark:text-gray-400">{{ t('localData.loading') }}</p>
    </div>

    <div
      v-else-if="loadError"
      class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-red-200 dark:border-red-900 shadow-sm"
      role="alert"
    >
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        {{ t('common.error') }}
      </h2>
      <p class="text-sm text-red-600 dark:text-red-400 mb-4">{{ loadError }}</p>
      <button
        @click="loadInventory"
        class="px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
      >
        {{ t('common.tryAgain') }}
      </button>
    </div>

    <template v-else>
      <!-- Stored API credentials -->
      <section
        class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm mb-6"
      >
        <h2 class="text-base font-medium text-gray-900 dark:text-white">
          {{ t('localData.credentialsTitle') }}
        </h2>
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-2">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ hasCredentials ? t('localData.credentialsStored') : t('localData.credentialsEmpty') }}
          </p>
          <button
            v-if="hasCredentials"
            @click="handleClearCredentials"
            :disabled="busy"
            class="self-start sm:self-auto px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            {{ t('localData.clearCredentials') }}
          </button>
        </div>
      </section>

      <!-- Retained records -->
      <div
        v-if="!hasRecords"
        class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm text-center"
      >
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {{ t('localData.empty') }}
        </h2>
        <p class="text-gray-600 dark:text-gray-400">{{ t('localData.emptyHint') }}</p>
      </div>

      <template v-else>
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm text-gray-600 dark:text-gray-400">
            {{ t('localData.summary', { count: records.length }) }}
          </p>
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ t('localData.totalSize', { size: formatBytes(totalSizeBytes) }) }}
          </p>
        </div>

        <div class="space-y-4">
          <article
            v-for="record in records"
            :key="`${record.kind}-${record.id}`"
            class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="font-semibold text-gray-900 dark:text-white">{{ record.title }}</h3>
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                    :class="stateClass(record)"
                  >
                    {{ stateLabel(record) }}
                  </span>
                </div>
                <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {{ kindLabel(record) }} • {{ formatDate(record.createdAt) }} •
                  {{ t('localData.messages', { count: record.messageCount }) }} •
                  {{ formatBytes(record.sizeBytes) }}
                </p>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">{{ reasonLabel(record) }}</p>
                <p
                  v-if="record.lifecycle === 'archived' || record.verification === 'legacy'"
                  class="text-xs text-gray-500 dark:text-gray-400 mt-1"
                >
                  {{ t('localData.recoverHint') }}
                </p>
              </div>
              <button
                @click="handleDelete(record)"
                :disabled="busy"
                class="shrink-0 px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60 disabled:opacity-50"
              >
                {{ t('localData.delete') }}
              </button>
            </div>
          </article>
        </div>

        <!-- Danger zone -->
        <section
          class="mt-8 p-4 bg-white dark:bg-gray-900 rounded-lg border border-red-200 dark:border-red-900 shadow-sm"
        >
          <h2 class="text-base font-medium text-gray-900 dark:text-white">
            {{ t('localData.dangerZone') }}
          </h2>
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-2">
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ t('localData.purgeConfirm', { count: records.length, size: formatBytes(totalSizeBytes) }) }}
            </p>
            <button
              @click="handlePurge"
              :disabled="busy"
              class="self-start sm:self-auto shrink-0 px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {{ t('localData.purge') }}
            </button>
          </div>
        </section>
      </template>
    </template>
  </div>
</template>
