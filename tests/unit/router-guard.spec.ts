import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'
import { resolveAccountRouteAccess } from '@/router'
import { useAccountsStore } from '@/stores'
import type { SavedAccount } from '@/types'

function createUserAccount(overrides: Partial<SavedAccount> = {}): SavedAccount {
  return {
    id: 'user-1',
    type: 'user',
    label: 'Alice',
    firstName: 'Alice',
    phone: '+1234567890',
    sessionString: 'session',
    createdAt: new Date('2024-03-10T12:00:00Z'),
    lastUsedAt: new Date('2024-03-10T12:00:00Z'),
    ...overrides,
  }
}

function createBotAccount(overrides: Partial<SavedAccount> = {}): SavedAccount {
  return {
    id: 'bot-1',
    type: 'bot',
    label: 'MyBot',
    botToken: '123:abc',
    sessionString: '',
    createdAt: new Date('2024-03-10T12:00:00Z'),
    lastUsedAt: new Date('2024-03-10T12:00:00Z'),
    ...overrides,
  }
}

function target(
  meta: Record<string, unknown>,
  fullPath = '/protected',
): Pick<RouteLocationNormalized, 'fullPath' | 'meta'> {
  return { fullPath, meta: meta as RouteLocationNormalized['meta'] }
}

function redirect(
  value: RouteLocationRaw | undefined,
): { name?: string; query?: Record<string, unknown> } {
  return value as unknown as { name?: string; query?: Record<string, unknown> }
}

describe('resolveAccountRouteAccess', () => {
  let accounts: ReturnType<typeof useAccountsStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    accounts = useAccountsStore()
  })

  it('allows public routes regardless of account state', () => {
    expect(resolveAccountRouteAccess(target({ requiresAuth: false }), accounts)).toBeUndefined()

    accounts.accounts = [createUserAccount()]
    accounts.activeAccountId = 'user-1'
    expect(resolveAccountRouteAccess(target({ requiresAuth: false }), accounts)).toBeUndefined()
  })

  it('redirects to home with intent when no account is active', () => {
    const result = redirect(
      resolveAccountRouteAccess(target({ requiresAuth: true, accountType: 'user' }, '/resend'), accounts),
    )

    expect(result).toMatchObject({
      name: 'home',
      query: { redirect: '/resend', needsAuth: 'true', accountType: 'user' },
    })
  })

  it('defaults the redirect account type to "any" when the route omits it', () => {
    const result = redirect(resolveAccountRouteAccess(target({ requiresAuth: true }, '/backups'), accounts))

    expect(result.query).toMatchObject({ accountType: 'any' })
  })

  it('allows an "any" auth route once any account is active', () => {
    accounts.accounts = [createBotAccount()]
    accounts.activeAccountId = 'bot-1'

    expect(
      resolveAccountRouteAccess(target({ requiresAuth: true, accountType: 'any' }), accounts),
    ).toBeUndefined()
  })

  it('allows a typed route when the active account already matches', () => {
    accounts.accounts = [createUserAccount()]
    accounts.activeAccountId = 'user-1'

    expect(
      resolveAccountRouteAccess(target({ requiresAuth: true, accountType: 'user' }), accounts),
    ).toBeUndefined()
  })

  it('auto-switches to a compatible account instead of redirecting', () => {
    accounts.accounts = [createBotAccount(), createUserAccount()]
    accounts.activeAccountId = 'bot-1'

    const result = resolveAccountRouteAccess(
      target({ requiresAuth: true, accountType: 'user' }),
      accounts,
    )

    expect(result).toBeUndefined()
    expect(accounts.activeAccountId).toBe('user-1')
  })

  it('redirects home when no compatible account exists for the required type', () => {
    accounts.accounts = [createBotAccount()]
    accounts.activeAccountId = 'bot-1'

    const result = redirect(
      resolveAccountRouteAccess(target({ requiresAuth: true, accountType: 'user' }, '/export'), accounts),
    )

    expect(result).toMatchObject({
      name: 'home',
      query: { redirect: '/export', needsAuth: 'true', accountType: 'user' },
    })
    // The active account must not change when there is nothing compatible to switch to.
    expect(accounts.activeAccountId).toBe('bot-1')
  })
})
