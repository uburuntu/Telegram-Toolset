/**
 * Backup management store
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Backup, ExportProgress, StorageEstimate } from '@/types'

export const useBackupsStore = defineStore('backups', () => {
  // State
  const backups = ref<Backup[]>([])
  const selectedBackupIds = ref<Set<string>>(new Set())
  const currentExport = ref<ExportProgress | null>(null)
  const storageEstimate = ref<StorageEstimate>({ used: 0, available: 0, percentUsed: 0 })
  const isLoading = ref(false)

  // Getters
  const backupCount = computed(() => backups.value.length)
  const totalStorageUsed = computed(() => backups.value.reduce((sum, b) => sum + b.storageSize, 0))
  const selectedBackups = computed(() =>
    backups.value.filter((b) => selectedBackupIds.value.has(b.id)),
  )
  const isExporting = computed(
    () =>
      currentExport.value !== null &&
      !['complete', 'error', 'cancelled'].includes(currentExport.value.phase),
  )
  const exportProgress = computed(() => {
    if (!currentExport.value || currentExport.value.totalMessages === 0) return 0
    return (currentExport.value.processedMessages / currentExport.value.totalMessages) * 100
  })

  // Actions
  function setBackups(newBackups: Backup[]) {
    backups.value = newBackups
  }

  function addBackup(backup: Backup) {
    backups.value.push(backup)
  }

  function removeBackup(id: string) {
    backups.value = backups.value.filter((b) => b.id !== id)
    selectedBackupIds.value.delete(id)
  }

  function toggleBackupSelection(id: string) {
    if (selectedBackupIds.value.has(id)) {
      selectedBackupIds.value.delete(id)
    } else {
      selectedBackupIds.value.add(id)
    }
  }

  function clearSelection() {
    selectedBackupIds.value.clear()
  }

  function startExport(totalMessages: number) {
    currentExport.value = {
      phase: 'initializing',
      totalMessages,
      processedMessages: 0,
      exportedTextMessages: 0,
      exportedMediaMessages: 0,
      failedMessages: 0,
      startTime: new Date(),
    }
  }

  function updateExportProgress(update: Partial<ExportProgress>) {
    if (currentExport.value) {
      currentExport.value = { ...currentExport.value, ...update }
    }
  }

  function completeExport() {
    if (currentExport.value) {
      currentExport.value.phase = 'complete'
    }
  }

  function cancelExport() {
    if (currentExport.value) {
      currentExport.value.phase = 'cancelled'
    }
  }

  function setExportError(message: string) {
    if (currentExport.value) {
      currentExport.value.phase = 'error'
      currentExport.value.errorMessage = message
    }
  }

  function clearExport() {
    currentExport.value = null
  }

  function setStorageEstimate(estimate: StorageEstimate) {
    storageEstimate.value = estimate
  }

  function setLoading(loading: boolean) {
    isLoading.value = loading
  }

  return {
    // State
    backups,
    selectedBackupIds,
    currentExport,
    storageEstimate,
    isLoading,
    // Getters
    backupCount,
    totalStorageUsed,
    selectedBackups,
    isExporting,
    exportProgress,
    // Actions
    setBackups,
    addBackup,
    removeBackup,
    toggleBackupSelection,
    clearSelection,
    startExport,
    updateExportProgress,
    completeExport,
    cancelExport,
    setExportError,
    clearExport,
    setStorageEstimate,
    setLoading,
  }
})
