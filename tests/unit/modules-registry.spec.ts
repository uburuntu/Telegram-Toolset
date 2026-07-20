import { describe, expect, it } from 'vitest'
import {
  getModule,
  getModuleRoutes,
  getModulesForAccountType,
  modules,
  validateModuleRegistry,
} from '@/modules'
import type { ModuleAccountType, ToolModule } from '@/types'

function makeModule(
  id: string,
  path: string,
  name: string,
  accountType: ModuleAccountType = 'any',
): ToolModule {
  return {
    id,
    name: id,
    description: '',
    icon: 'tool',
    accountType,
    route: { path, name, component: async () => ({}) },
  } as ToolModule
}

describe('module registry helpers', () => {
  it('looks up modules by id', () => {
    expect(getModule('resend')?.id).toBe('resend')
    expect(getModule('does-not-exist')).toBeUndefined()
  })

  it('returns one route per module with unique paths', () => {
    const routes = getModuleRoutes()
    expect(routes).toHaveLength(modules.length)

    const paths = routes.map((route) => route.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('returns every module when the account type is null', () => {
    expect(getModulesForAccountType(null)).toHaveLength(modules.length)
  })

  it('includes "any" modules for a specific account type', () => {
    const forBot = getModulesForAccountType('bot')
    expect(forBot.every((m) => m.accountType === 'any' || m.accountType === 'bot')).toBe(true)
    expect(forBot.some((m) => m.id === 'account-info')).toBe(true)

    const forUser = getModulesForAccountType('user')
    expect(forUser.some((m) => m.id === 'resend')).toBe(true)
    expect(forUser.some((m) => m.id === 'account-info')).toBe(true)
  })
})

describe('validateModuleRegistry', () => {
  it('accepts the shipped registry', () => {
    expect(() => validateModuleRegistry(modules)).not.toThrow()
  })

  it('rejects duplicate module ids', () => {
    expect(() =>
      validateModuleRegistry([makeModule('dup', '/a', 'a'), makeModule('dup', '/b', 'b')]),
    ).toThrow(/Duplicate module id/)
  })

  it('rejects duplicate route paths', () => {
    expect(() =>
      validateModuleRegistry([makeModule('a', '/same', 'a'), makeModule('b', '/same', 'b')]),
    ).toThrow(/Duplicate module route path/)
  })

  it('rejects duplicate route names', () => {
    expect(() =>
      validateModuleRegistry([makeModule('a', '/a', 'dup'), makeModule('b', '/b', 'dup')]),
    ).toThrow(/Duplicate module route name/)
  })

  it('rejects an invalid account type', () => {
    expect(() =>
      validateModuleRegistry([makeModule('a', '/a', 'a', 'ghost' as ModuleAccountType)]),
    ).toThrow(/Invalid accountType/)
  })
})
