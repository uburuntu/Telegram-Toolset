import { describe, expect, it } from 'vitest'
import {
  createJobContext,
  isCommitAllowed,
  isContextCurrent,
} from '@/services/jobs/job-context'
import type { TelegramPrincipal } from '@/types'

const principal: TelegramPrincipal = { kind: 'user', telegramUserId: '100' }

function makeContext(overrides: Partial<Parameters<typeof createJobContext>[0]> = {}) {
  return createJobContext({
    accountId: 'account-a',
    principal,
    sessionGeneration: 5,
    accountEpoch: 2,
    ...overrides,
  })
}

const currentEnvironment = {
  activeAccountId: 'account-a',
  sessionGeneration: 5,
  accountEpoch: 2,
}

describe('createJobContext', () => {
  it('captures ownership and generations and owns a fresh controller', () => {
    const { context, controller } = makeContext()

    expect(context.accountId).toBe('account-a')
    expect(context.principal).toEqual(principal)
    expect(context.sessionGeneration).toBe(5)
    expect(context.accountEpoch).toBe(2)
    expect(context.operationId).toMatch(/[0-9a-f-]{36}/)
    expect(context.signal.aborted).toBe(false)

    controller.abort()
    expect(context.signal.aborted).toBe(true)
  })

  it('assigns a unique operation id per job', () => {
    expect(makeContext().context.operationId).not.toBe(makeContext().context.operationId)
  })

  it('aborts immediately when the parent signal is already aborted', () => {
    const parent = new AbortController()
    parent.abort()
    const { context } = makeContext({ parentSignal: parent.signal })
    expect(context.signal.aborted).toBe(true)
  })

  it('propagates a later parent abort into the job signal', () => {
    const parent = new AbortController()
    const { context } = makeContext({ parentSignal: parent.signal })
    expect(context.signal.aborted).toBe(false)
    parent.abort()
    expect(context.signal.aborted).toBe(true)
  })
})

describe('isContextCurrent', () => {
  it('is true only when account, session, epoch match and the job is live', () => {
    const { context } = makeContext()
    expect(isContextCurrent(context, currentEnvironment)).toBe(true)
  })

  it('is false after the active account changes', () => {
    const { context } = makeContext()
    expect(isContextCurrent(context, { ...currentEnvironment, activeAccountId: 'account-b' })).toBe(
      false,
    )
  })

  it('is false after the session generation advances', () => {
    const { context } = makeContext()
    expect(isContextCurrent(context, { ...currentEnvironment, sessionGeneration: 6 })).toBe(false)
  })

  it('is false after the account epoch advances', () => {
    const { context } = makeContext()
    expect(isContextCurrent(context, { ...currentEnvironment, accountEpoch: 3 })).toBe(false)
  })

  it('is false once the job is cancelled', () => {
    const { context, controller } = makeContext()
    controller.abort()
    expect(isContextCurrent(context, currentEnvironment)).toBe(false)
  })
})

describe('isCommitAllowed', () => {
  it('allows a commit while the owning account epoch is unchanged', () => {
    const { context } = makeContext()
    expect(isCommitAllowed(context, { accountEpoch: 2 })).toBe(true)
  })

  it('rejects a commit once the owning account epoch advances (removal fence)', () => {
    const { context } = makeContext()
    expect(isCommitAllowed(context, { accountEpoch: 3 })).toBe(false)
  })

  it('rejects a commit for a cancelled job', () => {
    const { context, controller } = makeContext()
    controller.abort()
    expect(isCommitAllowed(context, { accountEpoch: 2 })).toBe(false)
  })

  it('ignores the active account so a switch-away-and-back still commits', () => {
    const { context } = makeContext()
    // Epoch is the authority; merely switching accounts (without removal) must not fence the write.
    expect(isCommitAllowed(context, { accountEpoch: 2 })).toBe(true)
  })
})
