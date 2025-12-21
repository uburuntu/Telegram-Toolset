/**
 * Module system type definitions
 */

import type { RouteRecordRaw } from 'vue-router'

export type ModulePermission = 'admin_log' | 'send_messages'

export type ModuleAccountType = 'user' | 'bot' | 'any'

export interface ToolModule {
  id: string
  name: string
  description: string
  icon: string
  route: RouteRecordRaw
  accountType: ModuleAccountType
  requiredPermissions?: ModulePermission[]
}
