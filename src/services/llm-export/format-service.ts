/**
 * Format Service for LLM Context Export
 *
 * Builds deterministic export documents and renders them into text-oriented
 * templates. Dates are formatted in UTC to keep exports stable across
 * timezones, DST changes, and future re-renders.
 */

import type {
  ChatExport,
  ChatExportDocument,
  ChatMessage,
  DateFormatOption,
  FormatConfig,
  FormatTemplate,
} from '@/types'

const EXPORT_DOCUMENT_SCHEMA_VERSION = 1
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatDate(date: Date, format: DateFormatOption): string {
  const year = date.getUTCFullYear()
  const month = MONTH_NAMES[date.getUTCMonth()] || ''
  const day = date.getUTCDate()
  const weekday = WEEKDAY_NAMES[date.getUTCDay()] || ''
  const hours = pad2(date.getUTCHours())
  const minutes = pad2(date.getUTCMinutes())

  switch (format) {
    case 'iso':
      return date.toISOString()
    case 'short':
      return `${month} ${day}, ${year}`
    case 'long':
      return `${weekday}, ${month} ${day}, ${year} ${hours}:${minutes} UTC`
    case 'time-only':
      return `${hours}:${minutes} UTC`
    case 'none':
      return ''
    default:
      return date.toISOString()
  }
}

function getDateKey(date: Date): string {
  return [date.getUTCFullYear(), pad2(date.getUTCMonth() + 1), pad2(date.getUTCDate())].join('-')
}

function formatDayHeader(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map((part) => Number(part))
  const date = new Date(Date.UTC(year || 0, (month || 1) - 1, day || 1))
  const weekday = WEEKDAY_NAMES[date.getUTCDay()] || ''
  const monthName = MONTH_NAMES[date.getUTCMonth()] || ''

  return `${weekday}, ${monthName} ${date.getUTCDate()}, ${date.getUTCFullYear()} UTC`
}

function getMediaPlaceholder(message: ChatMessage, config: FormatConfig): string {
  if (!message.hasMedia) return ''

  switch (config.mediaPlaceholder) {
    case 'skip':
      return ''
    case 'bracket':
      return `[${message.mediaType || 'media'}]`
    case 'emoji':
      switch (message.mediaType) {
        case 'photo':
          return '📷'
        case 'video':
          return '🎬'
        case 'audio':
          return '🎵'
        case 'voice':
          return '🎤'
        case 'document':
          return '📄'
        case 'sticker':
          return '🎨'
        case 'animation':
          return '🎞️'
        case 'videoNote':
          return '⏺️'
        default:
          return '📎'
      }
    default:
      return ''
  }
}

function buildSenderString(message: ChatMessage, config: FormatConfig): string {
  const parts: string[] = []

  if (config.includeSenderName) {
    const senderName = config.useOriginalSenderNames
      ? message.senderOriginalName || message.senderName
      : message.senderName

    if (senderName) {
      parts.push(senderName)
    }
  }

  if (config.includeSenderUsername && message.senderUsername) {
    parts.push(`@${message.senderUsername}`)
  }

  return parts.join(' ')
}

function buildMessageMap(messages: ChatMessage[]): Map<number, ChatMessage> {
  const map = new Map<number, ChatMessage>()
  for (const message of messages) {
    map.set(message.id, message)
  }
  return map
}

function getReplyContext(
  message: ChatMessage,
  messageMap: Map<number, ChatMessage>,
  config: FormatConfig,
): string | undefined {
  if (!config.includeReplyContext || !message.replyToMsgId) {
    return undefined
  }

  const replyTo = messageMap.get(message.replyToMsgId)
  if (!replyTo) {
    return `reply to #${message.replyToMsgId}`
  }

  const sender = buildSenderString(replyTo, config)
  return sender ? `reply to ${sender}` : `reply to #${message.replyToMsgId}`
}

function groupMessagesByDay(messages: ChatMessage[]): Map<string, ChatMessage[]> {
  const groups = new Map<string, ChatMessage[]>()

  for (const message of messages) {
    const key = getDateKey(message.date)
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)?.push(message)
  }

  return groups
}

function getSelectedDateRange(messages: ChatMessage[]): { from?: string; to?: string } | undefined {
  if (messages.length === 0) {
    return undefined
  }

  const timestamps = messages.map((message) => message.date.getTime())
  const from = new Date(Math.min(...timestamps))
  const to = new Date(Math.max(...timestamps))

  return {
    from: from.toISOString(),
    to: to.toISOString(),
  }
}

function serializeFilterDateRange(
  config: FormatConfig,
): { from?: string; to?: string } | undefined {
  if (!config.filterDateRange) {
    return undefined
  }

  return {
    from: config.filterDateRange.from?.toISOString(),
    to: config.filterDateRange.to?.toISOString(),
  }
}

export function prepareMessages(messages: ChatMessage[], config: FormatConfig): ChatMessage[] {
  let result = [...messages]

  if (config.filterDateRange?.from) {
    result = result.filter((message) => message.date >= config.filterDateRange!.from!)
  }
  if (config.filterDateRange?.to) {
    result = result.filter((message) => message.date <= config.filterDateRange!.to!)
  }

  result.sort((left, right) =>
    config.reverseOrder
      ? left.date.getTime() - right.date.getTime()
      : right.date.getTime() - left.date.getTime(),
  )

  if (config.messageLimit > 0) {
    result = result.slice(0, config.messageLimit)
  }

  return result
}

export function buildExportDocument(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig,
  options: {
    mediaPaths?: Map<number, string>
    template?: FormatTemplate
  } = {},
): ChatExportDocument {
  const preparedMessages = prepareMessages(messages, config)
  const messageMap = buildMessageMap(messages)

  return {
    schemaVersion: EXPORT_DOCUMENT_SCHEMA_VERSION,
    export: {
      id: chatExport.id,
      createdAt: chatExport.createdAt.toISOString(),
      template: options.template ?? config.template,
    },
    chat: {
      id: chatExport.chatId.toString(),
      peerId: chatExport.chatPeerId,
      title: chatExport.chatTitle,
      type: chatExport.chatType,
    },
    source: {
      cachedMessageCount: chatExport.messageCount,
      hasMedia: chatExport.hasMedia ?? (chatExport.mediaCount ?? 0) > 0,
      mediaCount: chatExport.mediaCount ?? 0,
      dateRange: {
        from: chatExport.dateRange.from.toISOString(),
        to: chatExport.dateRange.to.toISOString(),
      },
    },
    selection: {
      selectedMessageCount: preparedMessages.length,
      reverseOrder: config.reverseOrder,
      messageLimit: config.messageLimit,
      filterDateRange: serializeFilterDateRange(config),
      selectedDateRange: getSelectedDateRange(preparedMessages),
    },
    messages: preparedMessages.map((message) => {
      const replyContext = getReplyContext(message, messageMap, config)
      const mediaPlaceholder = getMediaPlaceholder(message, config)

      return {
        id: message.id,
        chatPeerId: message.chatPeerId || chatExport.chatPeerId,
        sender:
          message.senderName || message.senderOriginalName || message.senderUsername
            ? {
                peerId: message.senderPeerId,
                name: message.senderName,
                displayName: buildSenderString(message, config) || undefined,
                originalName: message.senderOriginalName,
                username: message.senderUsername,
              }
            : undefined,
        timestamp: message.date.toISOString(),
        day: getDateKey(message.date),
        replyToMessageId: message.replyToMsgId,
        replyContext,
        forwardedFrom: message.forwardedFrom,
        text: message.text,
        media: message.hasMedia
          ? {
              type: message.mediaType,
              filename: message.mediaFilename,
              size: message.mediaSize,
              mimeType: message.mediaMimeType,
              placeholder: mediaPlaceholder || undefined,
              archivePath: options.mediaPaths?.get(message.id),
            }
          : undefined,
      }
    }),
  }
}

export function getFormatFileExtension(template: FormatTemplate): string {
  switch (template) {
    case 'xml':
      return 'xml'
    case 'json':
      return 'json'
    case 'markdown':
      return 'md'
    default:
      return 'txt'
  }
}

export function getFormatMimeType(template: FormatTemplate): string {
  switch (template) {
    case 'xml':
      return 'application/xml;charset=utf-8'
    case 'json':
      return 'application/json;charset=utf-8'
    default:
      return 'text/plain;charset=utf-8'
  }
}

function shouldRenderMessageText(message: ChatMessage, config: FormatConfig): boolean {
  return !!message.text || !!getMediaPlaceholder(message, config)
}

function formatSingleMessageXml(
  message: ChatMessage,
  config: FormatConfig,
  messageMap: Map<number, ChatMessage>,
  indent: string,
): string {
  if (!shouldRenderMessageText(message, config)) {
    return ''
  }

  const attributes: string[] = []
  const sender = buildSenderString(message, config)
  const dateFormat =
    config.dateGrouping === 'per-day' && config.dateFormat !== 'iso'
      ? 'time-only'
      : config.dateFormat

  if (sender) {
    attributes.push(`from="${escapeXml(sender)}"`)
  }

  if (config.includeDate && config.dateFormat !== 'none') {
    attributes.push(`date="${escapeXml(formatDate(message.date, dateFormat))}"`)
  }

  if (config.includeMessageIds) {
    attributes.push(`id="${message.id}"`)
  }

  const replyContext = getReplyContext(message, messageMap, config)
  if (replyContext) {
    attributes.push(`reply="${escapeXml(replyContext)}"`)
  }

  if (message.forwardedFrom) {
    attributes.push(`forwarded_from="${escapeXml(message.forwardedFrom)}"`)
  }

  const content = [
    getMediaPlaceholder(message, config),
    message.text ? escapeXml(message.text) : '',
  ]
    .filter(Boolean)
    .join(' ')
  const attributesSuffix = attributes.length > 0 ? ` ${attributes.join(' ')}` : ''

  if (content) {
    return `${indent}<message${attributesSuffix}>${content}</message>`
  }

  return attributes.length > 0 ? `${indent}<message${attributesSuffix} />` : ''
}

function formatAsXml(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig,
): string {
  const preparedMessages = prepareMessages(messages, config)
  const renderableMessages = preparedMessages.filter((message) =>
    shouldRenderMessageText(message, config),
  )
  const messageMap = buildMessageMap(messages)
  const participants = new Set<string>()

  for (const message of renderableMessages) {
    const sender = buildSenderString(message, config)
    if (sender) {
      participants.add(sender)
    }
  }

  const attributes = [
    `chat="${escapeXml(chatExport.chatTitle)}"`,
    `messages="${renderableMessages.length}"`,
  ]
  if (participants.size > 0 && participants.size <= 10) {
    attributes.push(`participants="${escapeXml(Array.from(participants).join(', '))}"`)
  }

  const lines = [`<conversation ${attributes.join(' ')}>`]

  if (config.dateGrouping === 'per-day' && config.includeDate) {
    for (const [dayKey, dayMessages] of groupMessagesByDay(renderableMessages)) {
      lines.push(`  <day date="${escapeXml(formatDayHeader(dayKey))}">`)
      for (const message of dayMessages) {
        const line = formatSingleMessageXml(message, config, messageMap, '    ')
        if (line) {
          lines.push(line)
        }
      }
      lines.push('  </day>')
    }
  } else {
    for (const message of renderableMessages) {
      const line = formatSingleMessageXml(message, config, messageMap, '  ')
      if (line) {
        lines.push(line)
      }
    }
  }

  lines.push('</conversation>')
  return lines.join('\n')
}

function formatSingleMessagePlain(
  message: ChatMessage,
  config: FormatConfig,
  messageMap: Map<number, ChatMessage>,
): string[] {
  if (!shouldRenderMessageText(message, config)) {
    return []
  }

  const headerParts: string[] = []
  const dateFormat =
    config.dateGrouping === 'per-day' && config.dateFormat !== 'iso'
      ? 'time-only'
      : config.dateFormat
  const sender = buildSenderString(message, config)

  if (sender) {
    headerParts.push(sender)
  }
  if (config.includeDate && config.dateFormat !== 'none') {
    headerParts.push(`(${formatDate(message.date, dateFormat)})`)
  }
  if (config.includeMessageIds) {
    headerParts.push(`#${message.id}`)
  }

  const replyContext = getReplyContext(message, messageMap, config)
  if (replyContext) {
    headerParts.push(`[${replyContext}]`)
  }

  if (message.forwardedFrom) {
    headerParts.push(`[forwarded from ${message.forwardedFrom}]`)
  }

  const lines: string[] = []
  if (headerParts.length > 0) {
    lines.push(`${headerParts.join(' ')}:`)
  }

  const mediaPlaceholder = getMediaPlaceholder(message, config)
  if (mediaPlaceholder) {
    lines.push(mediaPlaceholder)
  }
  if (message.text) {
    lines.push(message.text)
  }

  return lines
}

function formatAsPlain(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig,
): string {
  const preparedMessages = prepareMessages(messages, config)
  const renderableMessages = preparedMessages.filter((message) =>
    shouldRenderMessageText(message, config),
  )
  const messageMap = buildMessageMap(messages)
  const lines = [`[${chatExport.chatTitle} - ${renderableMessages.length} messages]`, '']

  if (config.dateGrouping === 'per-day' && config.includeDate) {
    for (const [dayKey, dayMessages] of groupMessagesByDay(renderableMessages)) {
      lines.push(`--- ${formatDayHeader(dayKey)} ---`)
      lines.push('')
      for (const message of dayMessages) {
        lines.push(...formatSingleMessagePlain(message, config, messageMap), '')
      }
    }
  } else {
    for (const message of renderableMessages) {
      lines.push(...formatSingleMessagePlain(message, config, messageMap), '')
    }
  }

  return lines.join('\n').trim()
}

function formatAsJson(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig,
): string {
  return JSON.stringify(
    buildExportDocument(messages, chatExport, config, { template: 'json' }),
    null,
    2,
  )
}

function formatSingleMessageMarkdown(
  message: ChatMessage,
  config: FormatConfig,
  messageMap: Map<number, ChatMessage>,
): string[] {
  if (!shouldRenderMessageText(message, config)) {
    return []
  }

  const lines: string[] = []
  const headerParts: string[] = []
  const dateFormat =
    config.dateGrouping === 'per-day' && config.dateFormat !== 'iso'
      ? 'time-only'
      : config.dateFormat

  const sender = buildSenderString(message, config)
  if (sender) {
    headerParts.push(`**${sender}**`)
  }
  if (config.includeDate && config.dateFormat !== 'none') {
    headerParts.push(`*${formatDate(message.date, dateFormat)}*`)
  }
  if (config.includeMessageIds) {
    headerParts.push(`\`#${message.id}\``)
  }

  const replyContext = getReplyContext(message, messageMap, config)
  if (replyContext) {
    headerParts.push(`> ${replyContext}`)
  }

  if (headerParts.length > 0) {
    lines.push(headerParts.join(' '))
  }
  if (message.forwardedFrom) {
    lines.push(`> Forwarded from ${message.forwardedFrom}`)
  }

  const mediaPlaceholder = getMediaPlaceholder(message, config)
  if (mediaPlaceholder) {
    lines.push(mediaPlaceholder)
  }
  if (message.text) {
    lines.push(message.text)
  }

  return lines
}

function formatAsMarkdown(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig,
): string {
  const preparedMessages = prepareMessages(messages, config)
  const renderableMessages = preparedMessages.filter((message) =>
    shouldRenderMessageText(message, config),
  )
  const messageMap = buildMessageMap(messages)
  const lines = [
    `# ${chatExport.chatTitle}`,
    '',
    `*${renderableMessages.length} messages*`,
    '',
    '---',
    '',
  ]

  if (config.dateGrouping === 'per-day' && config.includeDate) {
    for (const [dayKey, dayMessages] of groupMessagesByDay(renderableMessages)) {
      lines.push(`## ${formatDayHeader(dayKey)}`, '')
      for (const message of dayMessages) {
        lines.push(...formatSingleMessageMarkdown(message, config, messageMap), '')
      }
    }
  } else {
    for (const message of renderableMessages) {
      lines.push(...formatSingleMessageMarkdown(message, config, messageMap), '')
    }
  }

  return lines.join('\n').trim()
}

function renderTemplateString(
  template: string,
  values: Record<string, string | undefined>,
): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_match, key) => values[key] || '')
}

function formatAsCustom(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig,
): string {
  const template =
    config.customTemplate || '{{chat_title}}\n\n{{#each messages}}{{sender}}: {{text}}\n{{/each}}'
  const preparedMessages = prepareMessages(messages, config)
  const messageMap = buildMessageMap(messages)
  const eachMatch = template.match(/\{\{#each messages\}\}([\s\S]*?)\{\{\/each\}\}/)
  const messageBlock = eachMatch?.[1] || '{{text}}\n'
  const renderableMessages = preparedMessages.filter((message) =>
    shouldRenderMessageText(message, config),
  )

  const renderedMessages = renderableMessages
    .map((message) => {
      const sender = buildSenderString(message, config)
      const replyContext = getReplyContext(message, messageMap, config)
      return renderTemplateString(messageBlock, {
        sender,
        date: config.includeDate ? formatDate(message.date, config.dateFormat) : '',
        id: String(message.id),
        text: message.text || '',
        media: getMediaPlaceholder(message, config),
        reply: replyContext,
        forward: message.forwardedFrom || '',
      })
    })
    .join('')

  const globalValues = {
    chat_title: chatExport.chatTitle,
    message_count: String(renderableMessages.length),
    messages: renderedMessages,
  }

  if (!eachMatch) {
    return renderTemplateString(template, globalValues)
  }

  const before = template.slice(0, eachMatch.index)
  const after = template.slice((eachMatch.index || 0) + eachMatch[0].length)
  return `${renderTemplateString(before, globalValues)}${renderedMessages}${renderTemplateString(after, globalValues)}`
}

export function formatMessages(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig,
): string {
  switch (config.template) {
    case 'xml':
      return formatAsXml(messages, chatExport, config)
    case 'json':
      return formatAsJson(messages, chatExport, config)
    case 'markdown':
      return formatAsMarkdown(messages, chatExport, config)
    case 'custom':
      return formatAsCustom(messages, chatExport, config)
    case 'plain':
    default:
      return formatAsPlain(messages, chatExport, config)
  }
}

export function formatPreview(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig,
  previewLimit: number = 10,
): string {
  return formatMessages(messages, chatExport, {
    ...config,
    messageLimit:
      config.messageLimit > 0 ? Math.min(config.messageLimit, previewLimit) : previewLimit,
  })
}

export function estimateOutputSize(
  messages: ChatMessage[],
  _chatExport: ChatExport,
  config: FormatConfig,
): number {
  const preparedMessages = prepareMessages(messages, config)
  if (preparedMessages.length === 0) {
    return 0
  }

  const averageMessageLength =
    preparedMessages.reduce((total, message) => total + (message.text?.length || 0), 0) /
      preparedMessages.length || 50
  const overhead = config.template === 'xml' ? 100 : config.template === 'json' ? 120 : 30

  return preparedMessages.length * (averageMessageLength + overhead)
}

export function getTemplateDescription(template: FormatTemplate): string {
  switch (template) {
    case 'xml':
      return 'XML format optimized for Claude and other LLMs that prefer structured markup'
    case 'plain':
      return 'Simple plain text format, easy to read and universally compatible'
    case 'json':
      return 'Stable JSON document for tooling, automation, and archive inspection'
    case 'markdown':
      return 'Markdown format with headers and formatting, good for documentation'
    case 'custom':
      return 'Define your own template with variables like {{sender}}, {{text}}, {{date}}'
    default:
      return ''
  }
}

export function getTemplateExample(template: FormatTemplate): string {
  switch (template) {
    case 'xml':
      return `<conversation chat="Family Group" messages="2">
  <message from="Alice" date="Mar 10, 2024">Hello everyone!</message>
  <message from="Bob" reply="reply to Alice">Hey! How are you?</message>
</conversation>`
    case 'plain':
      return `[Family Group - 2 messages]

Alice (Mar 10, 2024):
Hello everyone!

Bob [reply to Alice]:
Hey! How are you?`
    case 'json':
      return `{
  "schemaVersion": 1,
  "chat": { "title": "Family Group", "type": "supergroup" },
  "messages": [
    { "id": 1, "timestamp": "2024-03-10T10:00:00.000Z", "text": "Hello everyone!" }
  ]
}`
    case 'markdown':
      return `# Family Group

**Alice** *Mar 10, 2024*
Hello everyone!

**Bob** > reply to Alice
Hey! How are you?`
    case 'custom':
      return `{{chat_title}}
{{#each messages}}
[{{date}}] {{sender}}: {{text}}
{{/each}}`
    default:
      return ''
  }
}
