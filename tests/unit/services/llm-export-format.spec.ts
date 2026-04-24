import { describe, expect, it } from 'vitest'
import {
  buildExportDocument,
  estimateOutputSize,
  formatMessages,
  formatPreview,
  getTemplateDescription,
  getTemplateExample,
} from '@/services/llm-export/format-service'
import type { ChatExport, ChatMessage, FormatConfig, FormatTemplate } from '@/types'

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    chatId: BigInt('100'),
    chatPeerId: '-100100',
    date: new Date('2024-03-10T14:30:00Z'),
    hasMedia: false,
    ...overrides,
  }
}

function makeExport(overrides: Partial<ChatExport> = {}): ChatExport {
  return {
    id: 'test-export',
    chatId: BigInt('100'),
    chatPeerId: '-100100',
    chatTitle: 'Test Chat',
    chatType: 'supergroup',
    schemaVersion: 2,
    createdAt: new Date('2024-03-10T12:00:00Z'),
    messageCount: 3,
    hasMedia: true,
    mediaCount: 1,
    dateRange: {
      from: new Date('2024-03-10T10:00:00Z'),
      to: new Date('2024-03-11T09:00:00Z'),
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
    senderPeerId: '10',
    senderName: 'Alice',
    senderOriginalName: 'Alice T.',
    senderUsername: 'alice',
    text: 'Hello everyone!',
    date: new Date('2024-03-10T10:00:00Z'),
  }),
  makeMessage({
    id: 2,
    senderId: BigInt('20'),
    senderPeerId: '20',
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
    senderPeerId: '10',
    senderName: 'Alice',
    text: 'Check this photo',
    date: new Date('2024-03-11T09:00:00Z'),
    hasMedia: true,
    mediaType: 'photo',
    mediaFilename: 'photo.jpg',
    mediaMimeType: 'image/jpeg',
  }),
]

const chatExport = makeExport()

describe('formatMessages', () => {
  const templates: FormatTemplate[] = ['plain', 'xml', 'json', 'markdown', 'custom']

  it.each(templates)('produces non-empty output for "%s"', (template) => {
    expect(formatMessages(sampleMessages, chatExport, makeConfig({ template })).length).toBeGreaterThan(0)
  })

  it('renders deterministic UTC dates in plain text', () => {
    const output = formatMessages(sampleMessages, chatExport, makeConfig())
    expect(output).toContain('Mar 10, 2024')
    expect(output).toContain('[reply to Alice]')
  })

  it('uses UTC day headers for per-day grouping', () => {
    const output = formatMessages(sampleMessages, chatExport, makeConfig({ dateGrouping: 'per-day' }))
    expect(output).toContain('--- Sun, Mar 10, 2024 UTC ---')
    expect(output).toContain('--- Mon, Mar 11, 2024 UTC ---')
  })

  it('keeps the JSON schema stable regardless of date grouping', () => {
    const perMessage = JSON.parse(
      formatMessages(sampleMessages, chatExport, makeConfig({ template: 'json' })),
    )
    const perDay = JSON.parse(
      formatMessages(
        sampleMessages,
        chatExport,
        makeConfig({ template: 'json', dateGrouping: 'per-day' }),
      ),
    )

    expect(perMessage.schemaVersion).toBe(1)
    expect(perDay.schemaVersion).toBe(1)
    expect(perMessage.messages).toHaveLength(3)
    expect(perDay.messages).toHaveLength(3)
    expect(perMessage.messages[0].day).toBe('2024-03-10')
    expect(perDay.messages[0].day).toBe('2024-03-10')
    expect(perMessage.selection.selectedMessageCount).toBe(3)
    expect(perDay.selection.selectedMessageCount).toBe(3)
  })

  it('includes stable chat and selection metadata in JSON', () => {
    const parsed = JSON.parse(
      formatMessages(
        sampleMessages,
        chatExport,
        makeConfig({
          template: 'json',
          filterDateRange: { from: new Date('2024-03-10T10:03:00Z') },
        }),
      ),
    )

    expect(parsed.chat.title).toBe('Test Chat')
    expect(parsed.chat.peerId).toBe('-100100')
    expect(parsed.source.cachedMessageCount).toBe(3)
    expect(parsed.selection.selectedMessageCount).toBe(2)
    expect(parsed.selection.filterDateRange.from).toBe('2024-03-10T10:03:00.000Z')
    expect(parsed.selection.selectedDateRange.from).toBe('2024-03-10T10:05:00.000Z')
  })

  it('uses original sender names when enabled', () => {
    const output = formatMessages(
      sampleMessages,
      chatExport,
      makeConfig({ useOriginalSenderNames: true }),
    )

    expect(output).toContain('Alice T.')
    expect(output).toContain('Robert')
  })

  it('omits media-only messages from text outputs when media is skipped', () => {
    const output = formatMessages(
      [makeMessage({ senderName: 'Alice', hasMedia: true, mediaType: 'photo' })],
      chatExport,
      makeConfig({ mediaPlaceholder: 'skip' }),
    )

    expect(output).toBe('[Test Chat - 0 messages]')
  })

  it('does not rewrite user message text that contains template variables', () => {
    const output = formatMessages(
      [
        makeMessage({
          id: 99,
          senderName: 'Alice',
          text: 'Literal tokens: {{chat_title}} and {{media}} should stay.',
        }),
      ],
      chatExport,
      makeConfig({
        template: 'custom',
        customTemplate: '{{#each messages}}{{sender}} => {{text}}\n{{/each}}',
      }),
    )

    expect(output).toContain('Literal tokens: {{chat_title}} and {{media}} should stay.')
  })

  it('respects message ordering and limits', () => {
    const output = formatMessages(
      sampleMessages,
      chatExport,
      makeConfig({ reverseOrder: false, messageLimit: 1 }),
    )

    expect(output).toContain('Check this photo')
    expect(output).not.toContain('Hello everyone!')
  })
})

describe('buildExportDocument', () => {
  it('includes sender peer IDs and media metadata', () => {
    const document = buildExportDocument(sampleMessages, chatExport, makeConfig())

    expect(document.messages[0]?.sender?.peerId).toBe('10')
    expect(document.messages[2]?.media?.filename).toBe('photo.jpg')
    expect(document.messages[2]?.media?.placeholder).toBe('[photo]')
  })
})

describe('formatPreview', () => {
  it('limits the preview to the requested message count', () => {
    const preview = formatPreview(sampleMessages, chatExport, makeConfig(), 2)
    expect(preview).toContain('Hello everyone!')
    expect(preview).toContain('Hey Alice!')
    expect(preview).not.toContain('Check this photo')
  })
})

describe('estimateOutputSize', () => {
  it('returns a positive estimate and respects messageLimit', () => {
    const full = estimateOutputSize(sampleMessages, chatExport, makeConfig())
    const limited = estimateOutputSize(sampleMessages, chatExport, makeConfig({ messageLimit: 1 }))

    expect(full).toBeGreaterThan(0)
    expect(limited).toBeLessThan(full)
  })
})

describe('template helpers', () => {
  const templates: FormatTemplate[] = ['xml', 'plain', 'json', 'markdown', 'custom']

  it.each(templates)('returns a description for "%s"', (template) => {
    expect(getTemplateDescription(template).length).toBeGreaterThan(0)
  })

  it.each(templates)('returns an example for "%s"', (template) => {
    expect(getTemplateExample(template).length).toBeGreaterThan(0)
  })
})
