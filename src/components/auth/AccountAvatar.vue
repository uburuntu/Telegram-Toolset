<script setup lang="ts">
import { computed } from 'vue'
import type { SavedAccount } from '@/types'

const props = withDefaults(
  defineProps<{
    account: SavedAccount
    photoUrl?: string | null
    size?: 'sm' | 'md'
  }>(),
  {
    photoUrl: null,
    size: 'sm',
  },
)

const initials = computed(() => {
  const name = props.account.firstName || props.account.label
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] || '')
      .join('')
      .toUpperCase() || '?'
  )
})
</script>

<template>
  <span
    :class="[
      'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white',
      size === 'md' ? 'h-8 w-8 text-xs' : 'h-6 w-6 text-[10px]',
      account.type === 'bot' ? 'bg-purple-600' : 'bg-blue-600',
    ]"
    aria-hidden="true"
  >
    <img
      v-if="photoUrl"
      data-testid="account-avatar-image"
      :src="photoUrl"
      alt=""
      class="h-full w-full object-cover"
    />
    <span v-else>{{ initials }}</span>
  </span>
</template>
