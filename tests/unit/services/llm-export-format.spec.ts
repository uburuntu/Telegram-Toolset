import { describe, it, expect } from 'vitest'
import {
  formatMessages,
  formatPreview,
  estimateOutputSize,
  getTemplateDescription,
  getTemplateExample,
} from '@/services/llm-export/format-service'
import type { ChatExport, ChatMessage, FormatConfig, FormatTemplate } from '@/types'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    chatId: BigInt('100'),
    date: new Date('2024-03-10T14:30:00Z'),
    hasMedia: false,
    ...overrides,
  }
}

function makeExport(overrides: Partial<ChatExport> = {}): ChatExport {
  return {
    id: 'test-export',
    chatId: BigInt('100'),
    chatTitle: 'Test Chat',
    chatType: 'supergroup',
    createdAt: new Date('2024-03-10'),
    messageCount: 3,
    dateRange: {
      from: new Date('2024-03-10T10:00:00Z'),
      to: new Date('2024-03-10T16:00:00Z'),
    },
    ...overrides,
  }
}

function makeConfig(overrides: Partial<FormatConfig> = {}): FormatConfig {
  return {
    template: 'plain',
    includeDate: true,
    dateFormat: 'short',
    dateGrouping: 'per-message',
    includeSenderName: true,
    includeSenderUsername: false,
    useOriginalSenderNames: false,
    includeReplyContext: true,
    includeMessageIds: false,
    mediaPlaceholder: 'bracket',
    messageLimit: 0,
    reverseOrder: true,
    ...overrides,
  }
}

const sampleMessages: ChatMessage[] = [
  makeMessage({
    id: 1,
    senderId: BigInt('10'),
    senderName: 'Alice',
    senderOriginalName: 'Alice T.',
    senderUsername: 'alice',
    text: 'Hello everyone!',
    date: new Date('2024-03-10T10:00:00Z'),
  }),
  makeMessage({
    id: 2,
    senderId: BigInt('20'),
    senderName: 'Bob',
    senderOriginalName: 'Robert',
    senderUsername: 'bob',
    text: 'Hey Alice!',
    date: new Date('2024-03-10T10:05:00Z'),
    replyToMsgId: 1,
  }),
  makeMessage({
    id: 3,
    senderId: BigInt('10'),
    senderName: 'Alice',
    text: 'Check this photo',
    date: new Date('2024-03-11T09:00:00Z'),
    hasMedia: true,
    mediaType: 'photo',
  }),
]

const chatExport = makeExport()

// ---------------------------------------------------------------------------
// Template dispatch
// ---------------------------------------------------------------------------

describe('formatMessages', () => {
  describe('template dispatch', () => {
    const templates: FormatTemplate[] = ['plain', 'xml', 'json', 'markdown', 'custom']

    it.each(templates)('should produce non-empty output for template "%s"', (template) => {
      const config = makeConfig({ template })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output.length).toBeGreaterThan(0)
    })

    it('should fall back to plain for unknown template', () => {
      const config = makeConfig({ template: 'nonexistent' as FormatTemplate })
      const plain = formatMessages(sampleMessages, chatExport, makeConfig({ template: 'plain' }))
      const fallback = formatMessages(sampleMessages, chatExport, config)
      expect(fallback).toBe(plain)
    })
  })

  // -------------------------------------------------------------------------
  // Plain text template
  // -------------------------------------------------------------------------

  describe('plain text', () => {
    it('should include chat title header', () => {
      const output = formatMessages(sampleMessages, chatExport, makeConfig())
      expect(output).toContain('[Test Chat -')
      expect(output).toContain('messages]')
    })

    it('should include sender names', () => {
      const output = formatMessages(sampleMessages, chatExport, makeConfig())
      expect(output).toContain('Alice')
      expect(output).toContain('Bob')
    })

    it('should include message text', () => {
      const output = formatMessages(sampleMessages, chatExport, makeConfig())
      expect(output).toContain('Hello everyone!')
      expect(output).toContain('Hey Alice!')
    })

    it('should include reply context', () => {
      const output = formatMessages(sampleMessages, chatExport, makeConfig())
      expect(output).toContain('[reply to Alice]')
    })

    it('should include media placeholders', () => {
      const output = formatMessages(sampleMessages, chatExport, makeConfig())
      expect(output).toContain('[photo]')
    })
  })

  // -------------------------------------------------------------------------
  // XML template
  // -------------------------------------------------------------------------

  describe('xml', () => {
    it('should wrap in <conversation> tags', () => {
      const config = makeConfig({ template: 'xml' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toMatch(/^<conversation /)
      expect(output).toMatch(/<\/conversation>$/)
    })

    it('should include chat attribute', () => {
      const config = makeConfig({ template: 'xml' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('chat="Test Chat"')
    })

    it('should include message count attribute', () => {
      const config = makeConfig({ template: 'xml' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('messages="3"')
    })

    it('should include participants when <= 10', () => {
      const config = makeConfig({ template: 'xml' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('participants="Alice, Bob"')
    })

    it('should format messages with from attribute', () => {
      const config = makeConfig({ template: 'xml' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('from="Alice"')
      expect(output).toContain('from="Bob"')
    })

    it('should escape XML special characters', () => {
      const msgs = [makeMessage({ id: 1, text: 'a < b & c > d', senderName: 'O"Brien' })]
      const config = makeConfig({ template: 'xml' })
      const output = formatMessages(msgs, chatExport, config)
      expect(output).toContain('&lt;')
      expect(output).toContain('&amp;')
      expect(output).toContain('&gt;')
      expect(output).toContain('O&quot;Brien')
    })

    it('should include reply attribute', () => {
      const config = makeConfig({ template: 'xml' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('reply="reply to Alice"')
    })
  })

  // -------------------------------------------------------------------------
  // JSON template
  // -------------------------------------------------------------------------

  describe('json', () => {
    it('should produce valid JSON', () => {
      const config = makeConfig({ template: 'json' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(() => JSON.parse(output)).not.toThrow()
    })

    it('should include chat metadata', () => {
      const config = makeConfig({ template: 'json' })
      const parsed = JSON.parse(formatMessages(sampleMessages, chatExport, config))
      expect(parsed.chat).toBe('Test Chat')
      expect(parsed.type).toBe('supergroup')
      expect(parsed.message_count).toBe(3)
      expect(parsed.date_range).toBeDefined()
    })

    it('should include messages array', () => {
      const config = makeConfig({ template: 'json' })
      const parsed = JSON.parse(formatMessages(sampleMessages, chatExport, config))
      expect(parsed.messages).toHaveLength(3)
    })

    it('should include sender in message objects', () => {
      const config = makeConfig({ template: 'json' })
      const parsed = JSON.parse(formatMessages(sampleMessages, chatExport, config))
      expect(parsed.messages[0].from).toBe('Alice')
    })

    it('should include reply_to in message objects', () => {
      const config = makeConfig({ template: 'json' })
      const parsed = JSON.parse(formatMessages(sampleMessages, chatExport, config))
      const bob = parsed.messages.find((m: Record<string, unknown>) => m.from === 'Bob')
      expect(bob.reply_to).toContain('reply to Alice')
    })

    it('should use consistent "date" key for both per-message and per-day', () => {
      const configPerMsg = makeConfig({ template: 'json', dateGrouping: 'per-message' })
      const parsedPerMsg = JSON.parse(formatMessages(sampleMessages, chatExport, configPerMsg))
      expect(parsedPerMsg.messages[0]).toHaveProperty('date')
      expect(parsedPerMsg.messages[0]).not.toHaveProperty('time')

      const configPerDay = makeConfig({ template: 'json', dateGrouping: 'per-day' })
      const parsedPerDay = JSON.parse(formatMessages(sampleMessages, chatExport, configPerDay))
      const dayMsg = parsedPerDay.days[0].messages[0]
      expect(dayMsg).toHaveProperty('date')
      expect(dayMsg).not.toHaveProperty('time')
    })
  })

  // -------------------------------------------------------------------------
  // Markdown template
  // -------------------------------------------------------------------------

  describe('markdown', () => {
    it('should include h1 header with chat title', () => {
      const config = makeConfig({ template: 'markdown' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('# Test Chat')
    })

    it('should bold sender names', () => {
      const config = makeConfig({ template: 'markdown' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('**Alice**')
      expect(output).toContain('**Bob**')
    })

    it('should italicize dates', () => {
      const config = makeConfig({ template: 'markdown' })
      const output = formatMessages(sampleMessages, chatExport, config)
      // Should contain date in italic format like *Mar 10, 2024*
      expect(output).toMatch(/\*[A-Z][a-z]+ \d+/)
    })

    it('should include message count', () => {
      const config = makeConfig({ template: 'markdown' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('*3 messages*')
    })
  })

  // -------------------------------------------------------------------------
  // Custom template
  // -------------------------------------------------------------------------

  describe('custom template', () => {
    it('should replace {{chat_title}}', () => {
      const config = makeConfig({
        template: 'custom',
        customTemplate: 'Chat: {{chat_title}}',
      })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toBe('Chat: Test Chat')
    })

    it('should replace {{message_count}}', () => {
      const config = makeConfig({
        template: 'custom',
        customTemplate: 'Total: {{message_count}}',
      })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toBe('Total: 3')
    })

    it('should expand {{#each messages}} blocks', () => {
      const config = makeConfig({
        template: 'custom',
        customTemplate: '{{#each messages}}[{{sender}}] {{text}}\n{{/each}}',
      })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('[Alice] Hello everyone!')
      expect(output).toContain('[Bob] Hey Alice!')
    })

    it('should support {{date}}, {{media}}, {{reply}}, {{forward}} variables', () => {
      const config = makeConfig({
        template: 'custom',
        customTemplate:
          '{{#each messages}}{{sender}}|{{date}}|{{media}}|{{reply}}|{{forward}}\n{{/each}}',
      })
      const output = formatMessages(sampleMessages, chatExport, config)
      // Bob's message should have reply context
      expect(output).toContain('|reply to Alice|')
    })
  })

  // -------------------------------------------------------------------------
  // Config flags
  // -------------------------------------------------------------------------

  describe('includeSenderName', () => {
    it('should omit sender when disabled', () => {
      const config = makeConfig({ includeSenderName: false })
      const output = formatMessages(sampleMessages, chatExport, config)
      // Should not have "Alice:" or "Bob:" header lines
      expect(output).not.toMatch(/^Alice/m)
      expect(output).not.toMatch(/^Bob/m)
    })

    it('should include sender when enabled', () => {
      const config = makeConfig({ includeSenderName: true })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('Alice')
    })
  })

  describe('includeSenderUsername', () => {
    it('should include @username when enabled', () => {
      const config = makeConfig({ includeSenderUsername: true })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('@alice')
      expect(output).toContain('@bob')
    })

    it('should omit @username when disabled', () => {
      const config = makeConfig({ includeSenderUsername: false })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).not.toContain('@alice')
      expect(output).not.toContain('@bob')
    })
  })

  describe('useOriginalSenderNames', () => {
    it('should use contact name by default', () => {
      const config = makeConfig({ useOriginalSenderNames: false })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('Alice')
      expect(output).toContain('Bob')
    })

    it('should use original Telegram name when enabled', () => {
      const config = makeConfig({ useOriginalSenderNames: true })
      const output = formatMessages(sampleMessages, chatExport, config)
      // Alice has senderOriginalName: 'Alice T.'
      expect(output).toContain('Alice T.')
      // Bob has senderOriginalName: 'Robert'
      expect(output).toContain('Robert')
    })

    it('should fall back to senderName when originalName is missing', () => {
      const msgs = [makeMessage({ id: 1, senderName: 'ContactName', text: 'Hi' })]
      const config = makeConfig({ useOriginalSenderNames: true })
      const output = formatMessages(msgs, chatExport, config)
      expect(output).toContain('ContactName')
    })
  })

  describe('includeDate', () => {
    it('should include dates when enabled', () => {
      const config = makeConfig({ includeDate: true, dateFormat: 'iso' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('2024-03-10')
    })

    it('should omit dates when disabled', () => {
      const config = makeConfig({ includeDate: false })
      const output = formatMessages(sampleMessages, chatExport, config)
      // Should not contain any date-like patterns in parentheses
      expect(output).not.toMatch(/\(\w+ \d+\)/)
    })
  })

  describe('dateFormat', () => {
    it('should format as short', () => {
      const config = makeConfig({ dateFormat: 'short' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toMatch(/Mar \d+/)
    })

    it('should format as ISO', () => {
      const config = makeConfig({ dateFormat: 'iso' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toMatch(/2024-03-1\dT/)
    })

    it('should produce no date text when format is "none"', () => {
      const config = makeConfig({ includeDate: true, dateFormat: 'none' })
      const output = formatMessages(sampleMessages, chatExport, config)
      // Should not have date in parentheses
      expect(output).not.toMatch(/\(\d{4}-/)
    })
  })

  describe('dateGrouping', () => {
    it('per-message should not add day separators in plain text', () => {
      const config = makeConfig({ dateGrouping: 'per-message' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).not.toContain('---')
    })

    it('per-day should add day separators in plain text', () => {
      const config = makeConfig({ dateGrouping: 'per-day' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('---')
    })

    it('per-day should wrap in <day> elements for XML', () => {
      const config = makeConfig({ template: 'xml', dateGrouping: 'per-day' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('<day ')
      expect(output).toContain('</day>')
    })

    it('per-day should create "days" array for JSON', () => {
      const config = makeConfig({ template: 'json', dateGrouping: 'per-day' })
      const parsed = JSON.parse(formatMessages(sampleMessages, chatExport, config))
      expect(parsed.days).toBeDefined()
      expect(Array.isArray(parsed.days)).toBe(true)
      expect(parsed.days.length).toBeGreaterThan(0)
    })

    it('per-day should use ## day headers for markdown', () => {
      const config = makeConfig({ template: 'markdown', dateGrouping: 'per-day' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toMatch(/^## /m)
    })

    it('per-day should use time-only format within days (non-ISO)', () => {
      const config = makeConfig({ dateGrouping: 'per-day', dateFormat: 'short' })
      const output = formatMessages(sampleMessages, chatExport, config)
      // Should contain time-like format instead of full date
      expect(output).toMatch(/\d{1,2}:\d{2}/)
    })

    it('per-day should preserve ISO format when dateFormat is iso', () => {
      const config = makeConfig({ dateGrouping: 'per-day', dateFormat: 'iso' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toMatch(/2024-03-/)
    })
  })

  describe('includeReplyContext', () => {
    it('should include reply context when enabled', () => {
      const config = makeConfig({ includeReplyContext: true })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('reply to Alice')
    })

    it('should omit reply context when disabled', () => {
      const config = makeConfig({ includeReplyContext: false })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).not.toContain('reply to')
    })

    it('should fall back to message ID when replied message not in set', () => {
      const msgs = [makeMessage({ id: 5, text: 'response', replyToMsgId: 999 })]
      const config = makeConfig({ includeReplyContext: true })
      const output = formatMessages(msgs, chatExport, config)
      expect(output).toContain('reply to #999')
    })
  })

  describe('includeMessageIds', () => {
    it('should include IDs when enabled', () => {
      const config = makeConfig({ includeMessageIds: true })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('#1')
      expect(output).toContain('#2')
    })

    it('should omit IDs when disabled', () => {
      const config = makeConfig({ includeMessageIds: false })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).not.toContain('#1')
      // Make sure #2 isn't in the output (but reply to #X might be, so check specifically)
      expect(output).not.toMatch(/ #2\b/)
    })

    it('should include IDs in XML as id attribute', () => {
      const config = makeConfig({ template: 'xml', includeMessageIds: true })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('id="1"')
      expect(output).toContain('id="2"')
    })

    it('should include IDs in JSON objects', () => {
      const config = makeConfig({ template: 'json', includeMessageIds: true })
      const parsed = JSON.parse(formatMessages(sampleMessages, chatExport, config))
      expect(parsed.messages[0].id).toBe(1)
    })
  })

  describe('mediaPlaceholder', () => {
    it('bracket should show [type]', () => {
      const config = makeConfig({ mediaPlaceholder: 'bracket' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('[photo]')
    })

    it('emoji should show media emoji', () => {
      const config = makeConfig({ mediaPlaceholder: 'emoji' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('📷') // photo emoji
    })

    it('skip should omit media placeholders', () => {
      const config = makeConfig({ mediaPlaceholder: 'skip' })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).not.toContain('[photo]')
      expect(output).not.toContain('📷')
    })

    it('skip should omit media-only messages entirely in plain text', () => {
      const msgs = [
        makeMessage({ id: 1, senderName: 'Alice', hasMedia: true, mediaType: 'photo' }),
      ]
      const config = makeConfig({ mediaPlaceholder: 'skip' })
      const output = formatMessages(msgs, chatExport, config)
      // Should not produce an orphaned "Alice:" header with no content
      expect(output).not.toContain('Alice')
    })

    it('skip should omit media-only messages entirely in markdown', () => {
      const msgs = [
        makeMessage({ id: 1, senderName: 'Alice', hasMedia: true, mediaType: 'photo' }),
      ]
      const config = makeConfig({ template: 'markdown', mediaPlaceholder: 'skip' })
      const output = formatMessages(msgs, chatExport, config)
      expect(output).not.toContain('**Alice**')
    })

    it('should include text alongside media placeholder', () => {
      const config = makeConfig({ mediaPlaceholder: 'bracket' })
      const output = formatMessages(sampleMessages, chatExport, config)
      // Message 3 has both media and text
      expect(output).toContain('[photo]')
      expect(output).toContain('Check this photo')
    })

    it('bracket should handle unknown media type', () => {
      const msgs = [makeMessage({ id: 1, hasMedia: true, text: 'file' })]
      const config = makeConfig({ mediaPlaceholder: 'bracket' })
      const output = formatMessages(msgs, chatExport, config)
      expect(output).toContain('[media]')
    })

    it('emoji should show all media type emojis', () => {
      const mediaTypes = [
        { type: 'photo', emoji: '📷' },
        { type: 'video', emoji: '🎬' },
        { type: 'audio', emoji: '🎵' },
        { type: 'voice', emoji: '🎤' },
        { type: 'document', emoji: '📄' },
        { type: 'sticker', emoji: '🎨' },
        { type: 'animation', emoji: '🎞️' },
        { type: 'videoNote', emoji: '⏺️' },
      ] as const

      for (const { type, emoji } of mediaTypes) {
        const msgs = [makeMessage({ id: 1, hasMedia: true, mediaType: type, text: 'x' })]
        const config = makeConfig({ mediaPlaceholder: 'emoji' })
        const output = formatMessages(msgs, chatExport, config)
        expect(output).toContain(emoji)
      }
    })

    it('should show media type in JSON when not skip', () => {
      const config = makeConfig({ template: 'json', mediaPlaceholder: 'bracket' })
      const parsed = JSON.parse(formatMessages(sampleMessages, chatExport, config))
      const photoMsg = parsed.messages.find((m: Record<string, unknown>) => m.media === 'photo')
      expect(photoMsg).toBeDefined()
    })

    it('should omit media field in JSON when skip', () => {
      const config = makeConfig({ template: 'json', mediaPlaceholder: 'skip' })
      const parsed = JSON.parse(formatMessages(sampleMessages, chatExport, config))
      for (const msg of parsed.messages) {
        expect(msg).not.toHaveProperty('media')
      }
    })
  })

  describe('reverseOrder', () => {
    it('oldest first when enabled (default)', () => {
      const config = makeConfig({ reverseOrder: true })
      const output = formatMessages(sampleMessages, chatExport, config)
      const alicePos = output.indexOf('Hello everyone!')
      const bobPos = output.indexOf('Hey Alice!')
      expect(alicePos).toBeLessThan(bobPos)
    })

    it('newest first when disabled', () => {
      const config = makeConfig({ reverseOrder: false })
      const output = formatMessages(sampleMessages, chatExport, config)
      const alicePos = output.indexOf('Hello everyone!')
      const bobPos = output.indexOf('Hey Alice!')
      expect(bobPos).toBeLessThan(alicePos)
    })
  })

  describe('messageLimit', () => {
    it('0 should include all messages', () => {
      const config = makeConfig({ messageLimit: 0 })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('Hello everyone!')
      expect(output).toContain('Hey Alice!')
      expect(output).toContain('Check this photo')
    })

    it('should limit output to N messages', () => {
      const config = makeConfig({ messageLimit: 1 })
      const output = formatMessages(sampleMessages, chatExport, config)
      // With reverseOrder=true (oldest first), only first message
      expect(output).toContain('Hello everyone!')
      expect(output).not.toContain('Hey Alice!')
    })

    it('should work with JSON output', () => {
      const config = makeConfig({ template: 'json', messageLimit: 2 })
      const parsed = JSON.parse(formatMessages(sampleMessages, chatExport, config))
      expect(parsed.messages).toHaveLength(2)
      expect(parsed.message_count).toBe(2)
    })
  })

  describe('filterDateRange', () => {
    it('should filter messages by from date', () => {
      const config = makeConfig({
        filterDateRange: { from: new Date('2024-03-11T00:00:00Z') },
      })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).not.toContain('Hello everyone!')
      expect(output).not.toContain('Hey Alice!')
      expect(output).toContain('Check this photo')
    })

    it('should filter messages by to date', () => {
      const config = makeConfig({
        filterDateRange: { to: new Date('2024-03-10T10:02:00Z') },
      })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).toContain('Hello everyone!')
      expect(output).not.toContain('Hey Alice!')
    })

    it('should filter by both from and to', () => {
      const config = makeConfig({
        filterDateRange: {
          from: new Date('2024-03-10T10:03:00Z'),
          to: new Date('2024-03-10T10:10:00Z'),
        },
      })
      const output = formatMessages(sampleMessages, chatExport, config)
      expect(output).not.toContain('Hello everyone!')
      expect(output).toContain('Hey Alice!')
      expect(output).not.toContain('Check this photo')
    })
  })

  describe('forwarded messages', () => {
    it('should include forwarded info in plain text', () => {
      const msgs = [
        makeMessage({
          id: 1,
          senderName: 'Alice',
          text: 'Shared article',
          forwardedFrom: 'News Channel',
        }),
      ]
      const config = makeConfig()
      const output = formatMessages(msgs, chatExport, config)
      expect(output).toContain('[forwarded from News Channel]')
    })

    it('should include forwarded info in XML', () => {
      const msgs = [
        makeMessage({
          id: 1,
          senderName: 'Alice',
          text: 'Shared',
          forwardedFrom: 'News Channel',
        }),
      ]
      const config = makeConfig({ template: 'xml' })
      const output = formatMessages(msgs, chatExport, config)
      expect(output).toContain('forwarded_from="News Channel"')
    })

    it('should include forwarded info in JSON', () => {
      const msgs = [
        makeMessage({
          id: 1,
          senderName: 'Alice',
          text: 'Shared',
          forwardedFrom: 'News Channel',
        }),
      ]
      const config = makeConfig({ template: 'json' })
      const parsed = JSON.parse(formatMessages(msgs, chatExport, config))
      expect(parsed.messages[0].forwarded_from).toBe('News Channel')
    })
  })

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle empty messages array', () => {
      const config = makeConfig()
      const output = formatMessages([], chatExport, config)
      // Should still produce header
      expect(output).toContain('[Test Chat - 0 messages]')
    })

    it('should handle messages with no text and no media', () => {
      const msgs = [makeMessage({ id: 1, senderName: 'Alice' })]
      const config = makeConfig()
      const output = formatMessages(msgs, chatExport, config)
      // Should not crash
      expect(output).toBeDefined()
    })

    it('should handle messages with no sender info', () => {
      const msgs = [makeMessage({ id: 1, text: 'Anonymous message' })]
      const config = makeConfig()
      const output = formatMessages(msgs, chatExport, config)
      expect(output).toContain('Anonymous message')
    })

    it('should handle all flags disabled', () => {
      const config = makeConfig({
        includeSenderName: false,
        includeSenderUsername: false,
        includeDate: false,
        includeReplyContext: false,
        includeMessageIds: false,
        mediaPlaceholder: 'skip',
      })
      const output = formatMessages(sampleMessages, chatExport, config)
      // Should still contain message text
      expect(output).toContain('Hello everyone!')
    })
  })

  // -------------------------------------------------------------------------
  // Cross-template consistency
  // -------------------------------------------------------------------------

  describe('cross-template consistency', () => {
    const templates: FormatTemplate[] = ['plain', 'xml', 'json', 'markdown']

    it.each(templates)('template "%s" should respect messageLimit', (template) => {
      const config = makeConfig({ template, messageLimit: 1 })
      const output = formatMessages(sampleMessages, chatExport, config)
      // Only first message (oldest first by default) should appear
      expect(output).toContain('Hello everyone!')
      expect(output).not.toContain('Check this photo')
    })

    it.each(templates)('template "%s" should respect includeDate=false', (template) => {
      const configWith = makeConfig({ template, includeDate: true, dateFormat: 'iso' })
      const configWithout = makeConfig({ template, includeDate: false })
      const withDates = formatMessages(sampleMessages, chatExport, configWith)
      const withoutDates = formatMessages(sampleMessages, chatExport, configWithout)
      // ISO dates contain "2024-03-" which is distinctive
      expect(withDates).toContain('2024-03-')
      // Without dates, the output should be shorter (or not contain the ISO pattern in message context)
      expect(withoutDates.length).toBeLessThan(withDates.length)
    })

    it.each(templates)('template "%s" should respect includeSenderName=false', (template) => {
      const configWith = makeConfig({ template, includeSenderName: true })
      const configWithout = makeConfig({ template, includeSenderName: false })
      const with_ = formatMessages(sampleMessages, chatExport, configWith)
      const without = formatMessages(sampleMessages, chatExport, configWithout)
      expect(with_.length).toBeGreaterThan(without.length)
    })
  })
})

// ---------------------------------------------------------------------------
// formatPreview
// ---------------------------------------------------------------------------

describe('formatPreview', () => {
  it('should limit to previewLimit messages', () => {
    const manyMessages = Array.from({ length: 20 }, (_, i) =>
      makeMessage({
        id: i + 1,
        senderName: 'User',
        text: `Message ${i + 1}`,
        date: new Date(2024, 2, 10, 10, i),
      }),
    )
    const config = makeConfig()
    const preview = formatPreview(manyMessages, chatExport, config, 5)
    // Should contain at most 5 message texts
    const messageMatches = preview.match(/Message \d+/g)
    expect(messageMatches).not.toBeNull()
    expect(messageMatches!.length).toBeLessThanOrEqual(5)
  })

  it('should respect existing messageLimit if smaller than previewLimit', () => {
    const config = makeConfig({ messageLimit: 2 })
    const preview = formatPreview(sampleMessages, chatExport, config, 10)
    // Config says 2, preview says 10 — should use 2
    const output = formatMessages(sampleMessages, chatExport, makeConfig({ messageLimit: 2 }))
    expect(preview).toBe(output)
  })
})

// ---------------------------------------------------------------------------
// estimateOutputSize
// ---------------------------------------------------------------------------

describe('estimateOutputSize', () => {
  it('should return a positive number', () => {
    const config = makeConfig()
    const estimate = estimateOutputSize(sampleMessages, chatExport, config)
    expect(estimate).toBeGreaterThan(0)
  })

  it('should respect messageLimit', () => {
    const full = estimateOutputSize(sampleMessages, chatExport, makeConfig({ messageLimit: 0 }))
    const limited = estimateOutputSize(sampleMessages, chatExport, makeConfig({ messageLimit: 1 }))
    expect(limited).toBeLessThan(full)
  })

  it('should estimate higher for XML than plain text', () => {
    const xml = estimateOutputSize(sampleMessages, chatExport, makeConfig({ template: 'xml' }))
    const plain = estimateOutputSize(sampleMessages, chatExport, makeConfig({ template: 'plain' }))
    expect(xml).toBeGreaterThan(plain)
  })
})

// ---------------------------------------------------------------------------
// getTemplateDescription / getTemplateExample
// ---------------------------------------------------------------------------

describe('getTemplateDescription', () => {
  const templates: FormatTemplate[] = ['xml', 'plain', 'json', 'markdown', 'custom']

  it.each(templates)('should return non-empty description for "%s"', (template) => {
    expect(getTemplateDescription(template).length).toBeGreaterThan(0)
  })
})

describe('getTemplateExample', () => {
  const templates: FormatTemplate[] = ['xml', 'plain', 'json', 'markdown', 'custom']

  it.each(templates)('should return non-empty example for "%s"', (template) => {
    expect(getTemplateExample(template).length).toBeGreaterThan(0)
  })
})
