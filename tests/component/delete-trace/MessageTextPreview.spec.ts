import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from '@/i18n/locales/en.json'
import MessageTextPreview from '@/modules/delete-trace/components/MessageTextPreview.vue'
import type { TraceChatScan } from '@/services/delete-trace/delete-trace-service'

const scans: TraceChatScan[] = [
  {
    chat: {
      id: BigInt(10),
      title: 'Public Archive Chat',
      type: 'supergroup',
      canExport: false,
      canSend: true,
      isAdmin: false,
    },
    messageIds: [1, 2],
    messages: [
      {
        id: 1,
        date: new Date('2020-01-01T12:00:00.000Z'),
        preview: { kind: 'text', text: '<b>Literal user text</b>' },
      },
      {
        id: 2,
        date: new Date('2021-01-01T12:00:00.000Z'),
        preview: { kind: 'non_text' },
      },
    ],
  },
]

describe('MessageTextPreview', () => {
  it('renders every match as escaped plain text with bracketed non-text placeholders', () => {
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
    const wrapper = mount(MessageTextPreview, {
      props: { scans },
      global: { plugins: [i18n] },
    })

    expect(wrapper.text()).toContain('Showing 2 of 2')
    expect(wrapper.text()).toContain('=== Public Archive Chat ===')
    expect(wrapper.text()).toContain('[Media or sticker]')
    expect(wrapper.text()).toContain('<b>Literal user text</b>')
    expect(wrapper.find('b').exists()).toBe(false)

    const preview = wrapper.get('pre').text()
    expect(preview.indexOf('[Media or sticker]')).toBeLessThan(
      preview.indexOf('<b>Literal user text</b>'),
    )
  })
})
