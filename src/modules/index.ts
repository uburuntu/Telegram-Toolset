/**
 * Module registry
 *
 * Each module is self-contained and lazy-loaded.
 * To add a new module, add an entry to this array.
 */

import type { ToolModule } from '@/types'

export const modules: ToolModule[] = [
  {
    id: 'account-info',
    name: 'Account Info',
    description: 'View your account profile, settings, and capabilities',
    icon: 'user',
    accountType: 'any',
    route: {
      path: '/account-info',
      name: 'account-info',
      component: () => import('./account-info/AccountInfoView.vue'),
      meta: { requiresAuth: true, accountType: 'any' },
    },
  },
  {
    id: 'export-deleted',
    name: 'Export Deleted Messages',
    description: 'Save deleted messages from channels/groups you admin',
    icon: 'download',
    accountType: 'user',
    route: {
      path: '/export',
      name: 'export',
      component: () => import('./export-deleted/ExportView.vue'),
      meta: { requiresAuth: true, accountType: 'user' },
    },
    requiredPermissions: ['admin_log'],
  },
  {
    id: 'resend',
    name: 'Resend Messages',
    description: 'Re-send previously exported messages to any chat',
    icon: 'send',
    // Resend requires MTProto sendMessage, which is only available for user accounts.
    accountType: 'user',
    route: {
      path: '/resend',
      name: 'resend',
      component: () => import('./resend/ResendView.vue'),
      meta: { requiresAuth: true, accountType: 'user' },
    },
    requiredPermissions: ['send_messages'],
  },
  {
    id: 'scheduled',
    name: 'Scheduled Messages',
    description: 'View and manage your scheduled messages across all chats',
    icon: 'clock',
    accountType: 'user',
    route: {
      path: '/scheduled',
      name: 'scheduled',
      component: () => import('./scheduled/ScheduledView.vue'),
      meta: { requiresAuth: true, accountType: 'user' },
    },
  },
  {
    id: 'llm-export',
    name: 'LLM Context Export',
    description: 'Export chat history formatted for AI assistants like Claude',
    icon: 'sparkles',
    accountType: 'user',
    route: {
      path: '/llm-export',
      name: 'llm-export',
      component: () => import('./llm-export/LlmExportView.vue'),
      meta: { requiresAuth: true, accountType: 'user' },
    },
  },
]

/**
 * Placeholder for the "contribute" card shown on the landing page.
 * This is not a real module - it links to the GitHub repo.
 */
export const contributeCard = {
  id: 'contribute',
  name: 'Add Your Tool',
  description: 'Have an idea? Contribute a new module to this project',
  icon: 'plus',
  url: 'https://github.com/uburuntu/Telegram-Toolset#adding-a-new-module',
}

/**
 * Get module by ID
 */
export function getModule(id: string): ToolModule | undefined {
  return modules.find((m) => m.id === id)
}

/**
 * Get all module routes for Vue Router
 */
export function getModuleRoutes() {
  return modules.map((m) => m.route)
}

/**
 * Get modules filtered by account type
 */
export function getModulesForAccountType(type: 'user' | 'bot' | null): ToolModule[] {
  if (!type) return modules
  return modules.filter((m) => m.accountType === 'any' || m.accountType === type)
}

const VALID_ACCOUNT_TYPES: ReadonlySet<ToolModule['accountType']> = new Set(['user', 'bot', 'any'])

/**
 * Fail fast on a misconfigured registry. Duplicate ids, route paths, or route
 * names would otherwise surface as subtle routing/lookup bugs at runtime, so
 * enforce the registry invariants at module load instead.
 */
export function validateModuleRegistry(entries: readonly ToolModule[]): void {
  const ids = new Set<string>()
  const paths = new Set<string>()
  const names = new Set<string>()

  for (const module of entries) {
    if (ids.has(module.id)) {
      throw new Error(`Duplicate module id: ${module.id}`)
    }
    ids.add(module.id)

    if (!VALID_ACCOUNT_TYPES.has(module.accountType)) {
      throw new Error(`Invalid accountType "${module.accountType}" for module ${module.id}`)
    }

    const { path, name } = module.route
    if (paths.has(path)) {
      throw new Error(`Duplicate module route path: ${path}`)
    }
    paths.add(path)

    if (name != null) {
      const routeName = String(name)
      if (names.has(routeName)) {
        throw new Error(`Duplicate module route name: ${routeName}`)
      }
      names.add(routeName)
    }
  }
}

validateModuleRegistry(modules)
