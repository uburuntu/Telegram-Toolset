<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { cancelJob } from '@/services/jobs/job-runner'
import { useJobsStore } from '@/stores'
import type { JobRecord } from '@/types'

const { t } = useI18n()
const jobsStore = useJobsStore()

const hasAnything = computed(() => jobsStore.jobs.length > 0)

function percent(job: JobRecord): number | null {
  if (!job.progress || job.progress.total <= 0) {
    return null
  }
  return Math.min(100, Math.max(0, Math.round((job.progress.current / job.progress.total) * 100)))
}

function progressText(job: JobRecord): string {
  if (!job.progress) {
    return ''
  }
  const { current, total, label } = job.progress
  const counts = total > 0 ? `${current}/${total}` : ''
  return [label, counts].filter(Boolean).join(' · ')
}

const statusClass: Record<JobRecord['status'], string> = {
  running: 'text-blue-700 dark:text-blue-300',
  succeeded: 'text-green-700 dark:text-green-300',
  failed: 'text-red-700 dark:text-red-300',
  cancelled: 'text-gray-500 dark:text-gray-400',
}
</script>

<template>
  <section
    v-if="hasAnything"
    class="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900"
    :aria-label="t('jobs.heading')"
  >
    <div class="max-w-6xl mx-auto px-4 py-2 space-y-2">
      <div class="flex items-center justify-between">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {{ t('jobs.heading') }}
        </h2>
        <button
          v-if="jobsStore.recentJobs.length > 0"
          type="button"
          @click="jobsStore.clearRecent()"
          class="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors duration-100"
        >
          {{ t('jobs.clearCompleted') }}
        </button>
      </div>

      <ul class="space-y-1.5">
        <li
          v-for="job in jobsStore.jobs"
          :key="job.operationId"
          class="flex items-center gap-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-sm text-gray-900 dark:text-white truncate">{{ job.title }}</span>
              <span class="text-xs font-medium" :class="statusClass[job.status]">
                {{ t(`jobs.status.${job.status}`) }}
              </span>
            </div>

            <div
              v-if="job.status === 'running' && percent(job) !== null"
              class="mt-1 h-1 w-full rounded-full bg-gray-200 dark:bg-gray-800"
            >
              <div
                class="h-1 rounded-full bg-blue-600 transition-all duration-100 ease-out"
                :style="{ width: `${percent(job)}%` }"
              />
            </div>

            <p
              v-if="job.status === 'running' && progressText(job)"
              class="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate"
            >
              {{ progressText(job) }}
            </p>
            <p
              v-else-if="job.status === 'failed' && job.error"
              class="mt-0.5 text-xs text-red-600 dark:text-red-400 truncate"
            >
              {{ job.error }}
            </p>
          </div>

          <button
            v-if="job.status === 'running'"
            type="button"
            @click="cancelJob(job.operationId)"
            class="shrink-0 px-3 py-1 rounded-md text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors duration-100"
          >
            {{ t('common.cancel') }}
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
