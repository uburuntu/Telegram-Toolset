<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { backupManager } from '@/services/storage/backup-manager'
import { quotaManager } from '@/services/storage/quota'
import { useBackupsStore } from '@/stores'

const { t } = useI18n()
const backupsStore = useBackupsStore()

onMounted(async () => {
  backupsStore.setLoading(true)
  try {
    const [backups, estimate] = await Promise.all([
      backupManager.listBackups(),
      quotaManager.getStorageEstimate(),
    ])
    backupsStore.setBackups(backups)
    backupsStore.setStorageEstimate(estimate)
  } catch (e) {
    console.error('Failed to load backups:', e)
  } finally {
    backupsStore.setLoading(false)
  }
})

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

async function handleDelete(id: string) {
  if (!confirm('Are you sure you want to delete this backup?')) return

  try {
    await backupManager.deleteBackup(id)
    backupsStore.removeBackup(id)
    const estimate = await quotaManager.getStorageEstimate()
    backupsStore.setStorageEstimate(estimate)
  } catch (e) {
    console.error('Failed to delete backup:', e)
  }
}

async function handleDownload(id: string) {
  try {
    await backupManager.exportBackupToZip(id)
  } catch (e) {
    console.error('Failed to export backup:', e)
  }
}
</script>

<template>
  <div class="max-w-4xl mx-auto py-8 px-4">
    <header class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">{{ t('backups.title') }}</h1>
        <p class="text-gray-600 dark:text-gray-400 text-sm">
          {{ backupsStore.backupCount }} backup{{ backupsStore.backupCount !== 1 ? 's' : '' }}
        </p>
      </div>
      <router-link
        to="/export"
        class="px-4 py-2 rounded-lg font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700"
      >
        {{ t('backups.newExport') }}
      </router-link>
    </header>

    <!-- Storage indicator -->
    <div class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg mb-6">
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
          class="h-full bg-blue-600 transition-all"
          :style="{ width: `${backupsStore.storageEstimate.percentUsed}%` }"
          :class="{
            'bg-yellow-500': backupsStore.storageEstimate.percentUsed > 80,
            'bg-red-500': backupsStore.storageEstimate.percentUsed > 95,
          }"
        ></div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="backupsStore.isLoading" class="text-center py-12">
      <div
        class="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"
      ></div>
      <p class="text-gray-600 dark:text-gray-400">{{ t('backups.loading') }}</p>
    </div>

    <!-- Empty state -->
    <div v-else-if="backupsStore.backupCount === 0" class="text-center py-12">
      <div class="text-4xl mb-4">📭</div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-2">{{ t('backups.noBackups') }}</h2>
      <p class="text-gray-600 dark:text-gray-400 mb-6">
        {{ t('backups.noBackupsHint') }}
      </p>
      <router-link
        to="/export"
        class="px-4 py-2 rounded-lg font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700"
      >
        {{ t('backups.createFirst') }}
      </router-link>
    </div>

    <!-- Backup list -->
    <div v-else class="space-y-4">
      <div
        v-for="backup in backupsStore.backups"
        :key="backup.id"
        class="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700"
      >
        <div class="flex items-start gap-4">
          <input
            type="checkbox"
            :checked="backupsStore.selectedBackupIds.has(backup.id)"
            @change="backupsStore.toggleBackupSelection(backup.id)"
            class="mt-1"
          />
          <div class="flex-1">
            <h3 class="font-semibold text-gray-900 dark:text-white">
              {{ backup.chatTitle }}
            </h3>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              📅 {{ formatDate(backup.createdAt) }} • {{ backup.messageCount }} messages •
              {{ formatBytes(backup.storageSize) }}
            </p>
            <p v-if="backup.hasMedia" class="text-sm text-gray-500 dark:text-gray-500 mt-1">
              📷 {{ backup.mediaTypes.photos }} photos
              <template v-if="backup.mediaTypes.videos"
                >, 🎬 {{ backup.mediaTypes.videos }} videos</template
              >
              <template v-if="backup.mediaTypes.documents"
                >, 📄 {{ backup.mediaTypes.documents }} docs</template
              >
            </p>
          </div>
          <div class="flex gap-2">
            <button
              @click="handleDownload(backup.id)"
              class="px-4 py-2 rounded-lg font-medium text-sm transition-colors bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              {{ t('backups.downloadZip') }}
            </button>
            <button
              @click="handleDelete(backup.id)"
              class="px-4 py-2 rounded-lg font-medium text-sm transition-colors bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50"
            >
              {{ t('common.delete') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
