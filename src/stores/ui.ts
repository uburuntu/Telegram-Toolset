/**
 * UI state store (modals, toasts, navigation)
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

export interface Modal {
  id: string
  component: string
  props?: Record<string, unknown>
}

export const useUiStore = defineStore('ui', () => {
  // State
  const toasts = ref<Toast[]>([])
  const modals = ref<Modal[]>([])
  const isSidebarOpen = ref(false)
  const isMobile = ref(false)
  const hasSeenPrivacyNotice = ref(false)

  // Getters
  const currentModal = computed(() => modals.value[modals.value.length - 1] ?? null)
  const hasOpenModal = computed(() => modals.value.length > 0)

  // Actions
  function showToast(type: Toast['type'], message: string, duration = 5000) {
    const id = crypto.randomUUID()
    toasts.value.push({ id, type, message, duration })

    if (duration > 0) {
      setTimeout(() => dismissToast(id), duration)
    }

    return id
  }

  function dismissToast(id: string) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function openModal(component: string, props?: Record<string, unknown>) {
    const id = crypto.randomUUID()
    modals.value.push({ id, component, props })
    return id
  }

  function closeModal(id?: string) {
    if (id) {
      modals.value = modals.value.filter((m) => m.id !== id)
    } else {
      modals.value.pop()
    }
  }

  function closeAllModals() {
    modals.value = []
  }

  function toggleSidebar() {
    isSidebarOpen.value = !isSidebarOpen.value
  }

  function setSidebarOpen(open: boolean) {
    isSidebarOpen.value = open
  }

  function setMobile(mobile: boolean) {
    isMobile.value = mobile
  }

  function acknowledgePrivacyNotice() {
    hasSeenPrivacyNotice.value = true
    localStorage.setItem('privacy_notice_seen', 'true')
  }

  function loadPrivacyNoticeState() {
    hasSeenPrivacyNotice.value = localStorage.getItem('privacy_notice_seen') === 'true'
  }

  return {
    // State
    toasts,
    modals,
    isSidebarOpen,
    isMobile,
    hasSeenPrivacyNotice,
    // Getters
    currentModal,
    hasOpenModal,
    // Actions
    showToast,
    dismissToast,
    openModal,
    closeModal,
    closeAllModals,
    toggleSidebar,
    setSidebarOpen,
    setMobile,
    acknowledgePrivacyNotice,
    loadPrivacyNoticeState,
  }
})
