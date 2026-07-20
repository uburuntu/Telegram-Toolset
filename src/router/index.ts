/**
 * Vue Router configuration
 */

import type { RouteLocationNormalized, RouteLocationRaw, RouteRecordRaw } from 'vue-router'
import { createRouter, createWebHistory } from 'vue-router'
import { modules } from '@/modules'
import { useAccountsStore } from '@/stores'

type AccountsStore = ReturnType<typeof useAccountsStore>
type RouteAccessTarget = Pick<RouteLocationNormalized, 'fullPath' | 'meta'>

/**
 * Decides whether a navigation may proceed based on the active account.
 *
 * Returns `undefined` to allow navigation, or a redirect target when the route
 * requires an account the user doesn't currently have active. When a route
 * requires a specific account type and a compatible account exists, the active
 * account is switched in place (a deliberate side effect) so navigation can
 * continue instead of bouncing the user home.
 *
 * Extracted from the router guard so the auth-gating rules can be unit-tested
 * without loading the lazy route components.
 */
export function resolveAccountRouteAccess(
  to: RouteAccessTarget,
  accountsStore: AccountsStore,
): RouteLocationRaw | undefined {
  if (!to.meta.requiresAuth) {
    return undefined
  }

  const requiredAccountType = to.meta.accountType as 'user' | 'bot' | 'any' | undefined

  // If no active account, redirect to home with a message
  if (!accountsStore.activeAccount) {
    return {
      name: 'home',
      query: {
        redirect: to.fullPath,
        needsAuth: 'true',
        accountType: requiredAccountType || 'any',
      },
    }
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
        return {
          name: 'home',
          query: {
            redirect: to.fullPath,
            needsAuth: 'true',
            accountType: requiredAccountType,
          },
        }
      }
    }
  }

  return undefined
}

// Lazy-loaded views
const LandingView = () => import('@/views/LandingView.vue')
const BackupsView = () => import('@/views/BackupsView.vue')
const LocalDataView = () => import('@/views/LocalDataView.vue')

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
  {
    // Account-independent workspace: retained data can be inspected and cleaned up with no
    // active account, so this route intentionally does not require auth.
    path: '/local-data',
    name: 'local-data',
    component: LocalDataView,
    meta: { requiresAuth: false },
  },
  // Module routes
  ...moduleRoutes,
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Navigation guards
router.beforeEach(async (to) => {
  const accountsStore = useAccountsStore()

  // Load accounts from storage on first navigation
  if (!accountsStore.storageLoaded) {
    await accountsStore.loadFromStorage()
  }

  return resolveAccountRouteAccess(to, accountsStore)
})

export default router
