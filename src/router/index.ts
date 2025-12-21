/**
 * Vue Router configuration
 */

import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useAccountsStore } from '@/stores'
import { modules } from '@/modules'

// Lazy-loaded views
const LandingView = () => import('@/views/LandingView.vue')
const BackupsView = () => import('@/views/BackupsView.vue')

// Build routes from modules
const moduleRoutes: RouteRecordRaw[] = modules.map((m) => m.route)

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: LandingView,
    meta: { requiresAuth: false },
  },
  {
    path: '/backups',
    name: 'backups',
    component: BackupsView,
    meta: { requiresAuth: true, accountType: 'user' },
  },
  // Module routes
  ...moduleRoutes,
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Navigation guards
router.beforeEach((to, _from, next) => {
  const accountsStore = useAccountsStore()

  // Load accounts from storage on first navigation
  if (accountsStore.accounts.length === 0) {
    accountsStore.loadFromStorage()
  }

  // Check if route requires authentication
  if (to.meta.requiresAuth) {
    const requiredAccountType = to.meta.accountType as 'user' | 'bot' | 'any' | undefined

    // If no active account, redirect to home with a message
    if (!accountsStore.activeAccount) {
      // Store intended destination
      next({
        name: 'home',
        query: {
          redirect: to.fullPath,
          needsAuth: 'true',
          accountType: requiredAccountType || 'any',
        },
      })
      return
    }

    // Check account type compatibility
    if (requiredAccountType && requiredAccountType !== 'any') {
      if (accountsStore.activeAccount.type !== requiredAccountType) {
        // Check if we have a compatible account
        const compatibleAccounts = accountsStore.getCompatibleAccounts(requiredAccountType)
        const firstCompatible = compatibleAccounts[0]
        if (firstCompatible) {
          // Auto-switch to first compatible account
          accountsStore.setActiveAccount(firstCompatible.id)
        } else {
          // Redirect to home to add account
          next({
            name: 'home',
            query: {
              redirect: to.fullPath,
              needsAuth: 'true',
              accountType: requiredAccountType,
            },
          })
          return
        }
      }
    }
  }

  next()
})

export default router
