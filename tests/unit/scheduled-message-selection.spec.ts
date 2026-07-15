import { describe, expect, it } from 'vitest'
import {
  getScheduledMessageSelectionKey,
  groupScheduledMessageSelections,
} from '@/utils/scheduled-message-selection'

describe('scheduled message selection', () => {
  it('keeps negative marked chat IDs intact when grouping deletions', () => {
    const channelId = BigInt('-1001234567890')
    const privateChatId = BigInt('987654321')

    const grouped = groupScheduledMessageSelections([
      { chatId: channelId, messageId: 42 },
      { chatId: channelId, messageId: 43 },
      { chatId: privateChatId, messageId: 7 },
    ])

    expect(grouped.get(channelId)).toEqual([42, 43])
    expect(grouped.get(privateChatId)).toEqual([7])
  })

  it('creates unambiguous keys for negative chat IDs', () => {
    expect(getScheduledMessageSelectionKey(BigInt('-100123'), 42)).toBe('-100123:42')
    expect(getScheduledMessageSelectionKey(BigInt('-1001234'), 2)).not.toBe(
      getScheduledMessageSelectionKey(BigInt('-100123'), 42),
    )
  })
})
