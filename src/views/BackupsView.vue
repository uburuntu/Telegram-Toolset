<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { backupManager } from '@/services/storage/backup-manager'
import { quotaManager } from '@/services/storage/quota'
import { useAccountsStore, useBackupsStore, useUiStore } from '@/stores'
import type { Backup } from '@/types'
import { formatDateWithLocale } from '@/utils/locale-format'

const { t } = useI18n()
const accountsStore = useAccountsStore()
const backupsStore = useBackupsStore()
const uiStore = useUiStore()
const archivedBackups = ref<Backup[]>([])
const loadError = ref('')
let backupsRequestId = 0

async function loadBackups() {
  const requestId = ++backupsRequestId
  const account = accountsStore.activeAccount
  const accountId = account?.id ?? null
  backupsStore.setLoading(true)
  loadError.value = ''

  try {
    const [backups, estimate] = await Promise.all([
      backupManager.listBackupsForAccount(account),
      quotaManager.getStorageEstimate(),
    ])
    const archived = await backupManager.listArchivedBackups()

    if (requestId !== backupsRequestId || accountsStore.activeAccountId !== accountId) {
      return
    }

    backupsStore.setBackups(backups)
    archivedBackups.value = archived
    backupsStore.setStorageEstimate(estimate)
  } catch (error) {
    if (requestId !== backupsRequestId || accountsStore.activeAccountId !== accountId) {
      return
    }

    console.error('Failed to load backups:', error)
    loadError.value = error instanceof Error ? error.message : t('common.error')
  } finally {
    if (requestId === backupsRequestId && accountsStore.activeAccountId === accountId) {
      backupsStore.setLoading(false)
    }
  }
}

onMounted(async () => {
  await loadBackups()
})

onUnmounted(() => {
  backupsRequestId++
  backupsStore.setLoading(false)
})

watch(
  () => accountsStore.activeAccountId,
  async () => {
    backupsStore.setBackups([])
    backupsStore.clearSelection()
    archivedBackups.value = []
    loadError.value = ''
    await loadBackups()
  },
)

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

function formatDate(date: Date): string {
  return formatDateWithLocale(date, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

async function handleDelete(id: string) {
  if (!confirm(t('backups.confirmDelete'))) return

  try {
    await backupManager.deleteBackup(id)
    await loadBackups()
  } catch (error) {
    console.error('Failed to delete backup:', error)
    uiStore.showToast('error', t('common.error'))
  }
}

async function handleClaim(id: string) {
  const activeAccount = accountsStore.activeAccount
  if (!activeAccount || activeAccount.type !== 'user') {
    return
  }

  try {
    await backupManager.claimLegacyBackup(id, activeAccount)
    await loadBackups()
    uiStore.showToast('success', t('backups.claimSuccess'))
  } catch (error) {
    console.error('Failed to claim backup:', error)
    uiStore.showToast('error', t('backups.claimError'))
  }
}

async function handleDownload(id: string) {
  try {
    await backupManager.exportBackupToZip(id)
  } catch (error) {
    console.error('Failed to export backup:', error)
    uiStore.showToast('error', t('common.error'))
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <header class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('backups.title') }}</h1>
        <p class="text-gray-600 dark:text-gray-400 text-sm">
          {{ t('backups.count', { count: backupsStore.backupCount }) }}
        </p>
      </div>
      <router-link
        to="/export"
        class="px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-blue-600 text-white hover:bg-blue-700"
      >
        {{ t('backups.newExport') }}
      </router-link>
    </header>

    <div
      class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm mb-6"
    >
      <div class="flex justify-between text-sm mb-1">
        <span class="text-gray-600 dark:text-gray-400">{{ t('backups.storageUsed') }}</span>
        <span class="font-medium text-gray-900 dark:text-white">
          {{ formatBytes(backupsStore.storageEstimate.used) }} /
          {{
            formatBytes(backupsStore.storageEstimate.available + backupsStore.storageEstimate.used)
          }}
        </span>
      </div>
      <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          class="h-full bg-blue-600 transition-all duration-100 ease-out"
          :style="{ width: `${backupsStore.storageEstimate.percentUsed}%` }"
          :class="{
            'bg-amber-500': backupsStore.storageEstimate.percentUsed > 80,
            'bg-red-600': backupsStore.storageEstimate.percentUsed > 95,
          }"
        ></div>
      </div>
    </div>

    <div v-if="backupsStore.isLoading" class="text-center py-12">
      <div
        class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
      ></div>
      <p class="text-gray-600 dark:text-gray-400">{{ t('backups.loading') }}</p>
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
        @click="loadBackups"
        class="px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
      >
        {{ t('common.tryAgain') }}
      </button>
    </div>

    <div
      v-else-if="backupsStore.backupCount === 0"
      class="p-6 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm text-center"
    >
      <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        {{ archivedBackups.length > 0 ? t('backups.noActiveBackups') : t('backups.noBackups') }}
      </h2>
      <p class="text-gray-600 dark:text-gray-400 mb-6">
        {{
          archivedBackups.length > 0 ? t('backups.noActiveBackupsHint') : t('backups.noBackupsHint')
        }}
      </p>
      <router-link
        to="/export"
        class="inline-flex px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-blue-600 text-white hover:bg-blue-700"
      >
        {{ t('backups.createFirst') }}
      </router-link>
    </div>

    <div v-else class="space-y-4">
      <article
        v-for="backup in backupsStore.backups"
        :key="backup.id"
        class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <div class="flex items-start gap-4">
          <input
            type="checkbox"
            :checked="backupsStore.selectedBackupIds.has(backup.id)"
            @change="backupsStore.toggleBackupSelection(backup.id)"
            class="mt-1"
          />
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold text-gray-900 dark:text-white">
              {{ backup.chatTitle }}
            </h3>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ formatDate(backup.createdAt) }} •
              {{ t('backups.messages', { count: backup.messageCount }) }} •
              {{ formatBytes(backup.storageSize) }}
            </p>
            <p v-if="backup.hasMedia" class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {{ backup.mediaTypes.photos }} {{ t('backups.photos') }}
              <template v-if="backup.mediaTypes.videos">
                , {{ backup.mediaTypes.videos }} {{ t('backups.videos') }}
              </template>
              <template v-if="backup.mediaTypes.documents">
                , {{ backup.mediaTypes.documents }} {{ t('backups.docs') }}
              </template>
            </p>
            <div v-if="backup.ownershipState === 'legacy'" class="mt-3 space-y-2">
              <span
                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
              >
                {{ t('backups.legacyLabel') }}
              </span>
              <p class="text-xs text-amber-700 dark:text-amber-300">
                {{ t('backups.legacyHint') }}
              </p>
            </div>
          </div>
          <div class="flex flex-wrap justify-end gap-2">
            <button
              v-if="backup.ownershipState === 'legacy'"
              @click="handleClaim(backup.id)"
              class="px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 hover:bg-amber-200 dark:hover:bg-amber-900/70"
            >
              {{ t('backups.claim') }}
            </button>
            <button
              @click="handleDownload(backup.id)"
              class="px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
            >
              {{ t('backups.downloadZip') }}
            </button>
            <button
              @click="handleDelete(backup.id)"
              class="px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60"
            >
              {{ t('common.delete') }}
            </button>
          </div>
        </div>
      </article>
    </div>

    <section v-if="archivedBackups.length > 0" class="mt-8 space-y-4">
      <div>
        <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
          {{ t('backups.archivedTitle') }}
        </h2>
        <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
          {{ t('backups.archivedHint') }}
        </p>
      </div>

      <article
        v-for="backup in archivedBackups"
        :key="`archived-${backup.id}`"
        class="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="font-medium text-gray-900 dark:text-white">
              {{ backup.chatTitle }}
            </h3>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              {{ formatDate(backup.createdAt) }} •
              {{ t('backups.messages', { count: backup.messageCount }) }} •
              {{ formatBytes(backup.storageSize) }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {{ t('backups.archivedOn') }} {{ formatDate(backup.archivedAt ?? backup.createdAt) }}
            </p>
            <p
              v-if="backup.ownerAccountPhone"
              class="text-xs text-gray-500 dark:text-gray-400 mt-1"
            >
              {{ t('backups.removedAccountPhone', { phone: backup.ownerAccountPhone }) }}
            </p>
          </div>
          <button
            @click="handleDelete(backup.id)"
            class="px-4 py-2 rounded-md font-medium text-sm transition-colors duration-100 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/60"
          >
            {{ t('common.delete') }}
          </button>
        </div>
      </article>
    </section>
  </div>
</template>
