import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SessionRecoveryBanner from '@/components/layout/SessionRecoveryBanner.vue'
import { i18n } from '@/i18n'

describe('SessionRecoveryBanner', () => {
  it('explains the one-time session upgrade without implying data loss', async () => {
    const wrapper = mount(SessionRecoveryBanner, {
      props: {
        name: 'Alice',
        issue: 'incompatible',
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('Reconnect Alice after the connection upgrade')
    expect(wrapper.text()).toContain('Your account and local data are still here')

    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('reconnect')).toHaveLength(1)
  })

  it('keeps the existing expired-session copy for ordinary reauthentication', () => {
    const wrapper = mount(SessionRecoveryBanner, {
      props: { name: 'Alice', issue: 'expired' },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('Alice needs to log in again')
    expect(wrapper.text()).toContain('saved Telegram session is no longer valid')
  })
})
