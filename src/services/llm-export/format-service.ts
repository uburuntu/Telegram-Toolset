/**
 * Format Service for LLM Context Export
 *
 * Pure functions that transform ChatMessage[] + FormatConfig into formatted strings.
 * No side effects - all operations are synchronous and deterministic.
 */

import type {
  ChatMessage,
  ChatExport,
  FormatConfig,
  FormatTemplate,
  DateFormatOption,
} from '@/types'

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Format a date according to the specified format option
 */
function formatDate(date: Date, format: DateFormatOption): string {
  switch (format) {
    case 'iso':
      return date.toISOString()
    case 'short':
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
      })
    case 'long':
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    case 'time-only':
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    case 'none':
      return ''
    default:
      return date.toISOString()
  }
}

/**
 * Get media placeholder text based on config
 */
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

/**
 * Build sender string based on config
 */
function buildSenderString(message: ChatMessage, config: FormatConfig): string {
  const parts: string[] = []

  if (config.includeSenderName) {
    // Use original name if configured and available, otherwise fallback to contact name
    const name = config.useOriginalSenderNames
      ? message.senderOriginalName || message.senderName
      : message.senderName
    if (name) {
      parts.push(name)
    }
  }

  if (config.includeSenderUsername && message.senderUsername) {
    parts.push(`@${message.senderUsername}`)
  }

  return parts.join(' ')
}

/**
 * Get the date key for grouping (YYYY-MM-DD)
 */
function getDateKey(date: Date): string {
  return date.toISOString().split('T')[0] || ''
}

/**
 * Format a date as a day header
 */
function formatDayHeader(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Group messages by day
 */
function groupMessagesByDay(messages: ChatMessage[]): Map<string, ChatMessage[]> {
  const groups = new Map<string, ChatMessage[]>()

  for (const msg of messages) {
    const key = getDateKey(msg.date)
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(msg)
  }

  return groups
}

/**
 * Filter and prepare messages based on config
 */
function prepareMessages(messages: ChatMessage[], config: FormatConfig): ChatMessage[] {
  let result = [...messages]

  // Apply date range filter
  if (config.filterDateRange) {
    if (config.filterDateRange.from) {
      result = result.filter((m) => m.date >= config.filterDateRange!.from!)
    }
    if (config.filterDateRange.to) {
      result = result.filter((m) => m.date <= config.filterDateRange!.to!)
    }
  }

  // Apply ordering
  if (config.reverseOrder) {
    result.sort((a, b) => a.date.getTime() - b.date.getTime())
  } else {
    result.sort((a, b) => b.date.getTime() - a.date.getTime())
  }

  // Apply limit
  if (config.messageLimit > 0) {
    result = result.slice(0, config.messageLimit)
  }

  return result
}

/**
 * Build a map of message IDs to messages for reply context
 */
function buildMessageMap(messages: ChatMessage[]): Map<number, ChatMessage> {
  const map = new Map<number, ChatMessage>()
  for (const msg of messages) {
    map.set(msg.id, msg)
  }
  return map
}

/**
 * Get reply context string
 */
function getReplyContext(
  message: ChatMessage,
  messageMap: Map<number, ChatMessage>,
  config: FormatConfig
): string | null {
  if (!config.includeReplyContext || !message.replyToMsgId) return null

  const replyTo = messageMap.get(message.replyToMsgId)
  if (!replyTo) return `reply to #${message.replyToMsgId}`

  const sender = buildSenderString(replyTo, config)
  if (sender) return `reply to ${sender}`

  return `reply to #${message.replyToMsgId}`
}

// =============================================================================
// Format Templates
// =============================================================================

/**
 * Format a single message as XML (helper for date grouping)
 */
function formatSingleMessageXml(
  msg: ChatMessage,
  config: FormatConfig,
  messageMap: Map<number, ChatMessage>,
  indent: string,
  showDate: boolean
): string {
  const msgAttrs: string[] = []

  // Sender
  const sender = buildSenderString(msg, config)
  if (sender) {
    msgAttrs.push(`from="${escapeXml(sender)}"`)
  }

  // Date - only show if requested and showDate is true
  if (showDate && config.includeDate && config.dateFormat !== 'none') {
    // For per-day grouping, use time-only format
    const dateFormat =
      config.dateGrouping === 'per-day' && config.dateFormat !== 'iso' ? 'time-only' : config.dateFormat
    msgAttrs.push(`date="${escapeXml(formatDate(msg.date, dateFormat))}"`)
  }

  // Message ID
  if (config.includeMessageIds) {
    msgAttrs.push(`id="${msg.id}"`)
  }

  // Reply context
  const replyContext = getReplyContext(msg, messageMap, config)
  if (replyContext) {
    msgAttrs.push(`reply="${escapeXml(replyContext)}"`)
  }

  // Forwarded
  if (msg.forwardedFrom) {
    msgAttrs.push(`forwarded_from="${escapeXml(msg.forwardedFrom)}"`)
  }

  // Build content
  const contentParts: string[] = []
  const mediaPlaceholder = getMediaPlaceholder(msg, config)
  if (mediaPlaceholder) contentParts.push(mediaPlaceholder)
  if (msg.text) contentParts.push(escapeXml(msg.text))

  const content = contentParts.join(' ')

  if (content) {
    return `${indent}<message ${msgAttrs.join(' ')}>${content}</message>`
  } else if (msgAttrs.length > 0) {
    return `${indent}<message ${msgAttrs.join(' ')} />`
  }
  return ''
}

/**
 * Format messages as XML (Claude-optimized)
 */
function formatAsXml(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig
): string {
  const prepared = prepareMessages(messages, config)
  const messageMap = buildMessageMap(messages)

  // Collect unique participants
  const participants = new Set<string>()
  for (const msg of prepared) {
    const sender = buildSenderString(msg, config)
    if (sender) participants.add(sender)
  }

  const lines: string[] = []

  // Opening tag with metadata
  const attrs: string[] = [`chat="${escapeXml(chatExport.chatTitle)}"`]
  if (participants.size > 0 && participants.size <= 10) {
    attrs.push(`participants="${escapeXml(Array.from(participants).join(', '))}"`)
  }
  attrs.push(`messages="${prepared.length}"`)

  lines.push(`<conversation ${attrs.join(' ')}>`)

  // Check if using per-day grouping
  if (config.dateGrouping === 'per-day' && config.includeDate) {
    const dayGroups = groupMessagesByDay(prepared)

    for (const [dateKey, dayMessages] of dayGroups) {
      // Add day wrapper
      const dayDate = new Date(dateKey + 'T00:00:00')
      lines.push(`  <day date="${escapeXml(formatDayHeader(dayDate))}">`)

      // Add messages for this day
      for (const msg of dayMessages) {
        const line = formatSingleMessageXml(msg, config, messageMap, '    ', true)
        if (line) lines.push(line)
      }

      lines.push('  </day>')
    }
  } else {
    // Original per-message behavior
    for (const msg of prepared) {
      const line = formatSingleMessageXml(msg, config, messageMap, '  ', true)
      if (line) lines.push(line)
    }
  }

  lines.push('</conversation>')

  return lines.join('\n')
}

/**
 * Format a single message as plain text (helper for date grouping)
 */
function formatSingleMessagePlain(
  msg: ChatMessage,
  config: FormatConfig,
  messageMap: Map<number, ChatMessage>,
  showDate: boolean
): string[] {
  const lines: string[] = []
  const headerParts: string[] = []

  // Sender
  const sender = buildSenderString(msg, config)
  if (sender) {
    headerParts.push(sender)
  }

  // Date - only show if requested and showDate is true
  if (showDate && config.includeDate && config.dateFormat !== 'none') {
    // For per-day grouping, use time-only format
    const dateFormat =
      config.dateGrouping === 'per-day' && config.dateFormat !== 'iso' ? 'time-only' : config.dateFormat
    headerParts.push(`(${formatDate(msg.date, dateFormat)})`)
  }

  // Message ID
  if (config.includeMessageIds) {
    headerParts.push(`#${msg.id}`)
  }

  // Reply context
  const replyContext = getReplyContext(msg, messageMap, config)
  if (replyContext) {
    headerParts.push(`[${replyContext}]`)
  }

  // Forwarded
  if (msg.forwardedFrom) {
    headerParts.push(`[forwarded from ${msg.forwardedFrom}]`)
  }

  // Header line
  if (headerParts.length > 0) {
    lines.push(headerParts.join(' ') + ':')
  }

  // Content
  const mediaPlaceholder = getMediaPlaceholder(msg, config)
  if (mediaPlaceholder) {
    lines.push(mediaPlaceholder)
  }
  if (msg.text) {
    lines.push(msg.text)
  }

  return lines
}

/**
 * Format messages as plain text
 */
function formatAsPlain(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig
): string {
  const prepared = prepareMessages(messages, config)
  const messageMap = buildMessageMap(messages)

  const lines: string[] = []

  // Header
  lines.push(`[${chatExport.chatTitle} - ${prepared.length} messages]`)
  lines.push('')

  // Check if using per-day grouping
  if (config.dateGrouping === 'per-day' && config.includeDate) {
    const dayGroups = groupMessagesByDay(prepared)

    for (const [dateKey, dayMessages] of dayGroups) {
      // Add day separator
      const dayDate = new Date(dateKey + 'T00:00:00')
      lines.push(`--- ${formatDayHeader(dayDate)} ---`)
      lines.push('')

      // Add messages for this day
      for (const msg of dayMessages) {
        const msgLines = formatSingleMessagePlain(msg, config, messageMap, true)
        lines.push(...msgLines)
        lines.push('')
      }
    }
  } else {
    // Original per-message behavior
    for (const msg of prepared) {
      const msgLines = formatSingleMessagePlain(msg, config, messageMap, true)
      lines.push(...msgLines)
      lines.push('')
    }
  }

  return lines.join('\n').trim()
}

/**
 * Format a single message as JSON object (helper for date grouping)
 */
function formatSingleMessageJson(
  msg: ChatMessage,
  config: FormatConfig,
  messageMap: Map<number, ChatMessage>,
  showDate: boolean
): Record<string, unknown> {
  const obj: Record<string, unknown> = {}

  if (config.includeMessageIds) {
    obj.id = msg.id
  }

  const sender = buildSenderString(msg, config)
  if (sender) {
    obj.from = sender
  }

  if (showDate && config.includeDate && config.dateFormat !== 'none') {
    // For per-day grouping, use time-only format
    const dateFormat =
      config.dateGrouping === 'per-day' && config.dateFormat !== 'iso' ? 'time-only' : config.dateFormat
    obj.time = formatDate(msg.date, dateFormat)
  }

  const replyContext = getReplyContext(msg, messageMap, config)
  if (replyContext) {
    obj.reply_to = replyContext
  }

  if (msg.forwardedFrom) {
    obj.forwarded_from = msg.forwardedFrom
  }

  if (msg.text) {
    obj.text = msg.text
  }

  const mediaPlaceholder = getMediaPlaceholder(msg, config)
  if (mediaPlaceholder && config.mediaPlaceholder !== 'skip') {
    obj.media = msg.mediaType || 'unknown'
  }

  return obj
}

/**
 * Format messages as JSON
 */
function formatAsJson(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig
): string {
  const prepared = prepareMessages(messages, config)
  const messageMap = buildMessageMap(messages)

  // Check if using per-day grouping
  if (config.dateGrouping === 'per-day' && config.includeDate) {
    const dayGroups = groupMessagesByDay(prepared)

    interface JsonDay {
      date: string
      messages: Record<string, unknown>[]
    }

    const days: JsonDay[] = []

    for (const [dateKey, dayMessages] of dayGroups) {
      const dayDate = new Date(dateKey + 'T00:00:00')
      days.push({
        date: formatDayHeader(dayDate),
        messages: dayMessages.map((msg) => formatSingleMessageJson(msg, config, messageMap, true)),
      })
    }

    const output = {
      chat: chatExport.chatTitle,
      type: chatExport.chatType,
      message_count: prepared.length,
      date_range: {
        from: chatExport.dateRange.from.toISOString(),
        to: chatExport.dateRange.to.toISOString(),
      },
      days,
    }

    return JSON.stringify(output, null, 2)
  }

  // Original per-message behavior
  const jsonMessages = prepared.map((msg) => {
    const obj: Record<string, unknown> = {}

    if (config.includeMessageIds) {
      obj.id = msg.id
    }

    const sender = buildSenderString(msg, config)
    if (sender) {
      obj.from = sender
    }

    if (config.includeDate && config.dateFormat !== 'none') {
      obj.date = formatDate(msg.date, config.dateFormat)
    }

    const replyContext = getReplyContext(msg, messageMap, config)
    if (replyContext) {
      obj.reply_to = replyContext
    }

    if (msg.forwardedFrom) {
      obj.forwarded_from = msg.forwardedFrom
    }

    if (msg.text) {
      obj.text = msg.text
    }

    const mediaPlaceholder = getMediaPlaceholder(msg, config)
    if (mediaPlaceholder && config.mediaPlaceholder !== 'skip') {
      obj.media = msg.mediaType || 'unknown'
    }

    return obj
  })

  const output = {
    chat: chatExport.chatTitle,
    type: chatExport.chatType,
    message_count: prepared.length,
    date_range: {
      from: chatExport.dateRange.from.toISOString(),
      to: chatExport.dateRange.to.toISOString(),
    },
    messages: jsonMessages,
  }

  return JSON.stringify(output, null, 2)
}

/**
 * Format a single message as Markdown (helper for date grouping)
 */
function formatSingleMessageMarkdown(
  msg: ChatMessage,
  config: FormatConfig,
  messageMap: Map<number, ChatMessage>,
  showDate: boolean
): string[] {
  const lines: string[] = []
  const headerParts: string[] = []

  // Sender (bold)
  const sender = buildSenderString(msg, config)
  if (sender) {
    headerParts.push(`**${sender}**`)
  }

  // Date (italic) - only show if requested and showDate is true
  if (showDate && config.includeDate && config.dateFormat !== 'none') {
    // For per-day grouping, use time-only format
    const dateFormat =
      config.dateGrouping === 'per-day' && config.dateFormat !== 'iso' ? 'time-only' : config.dateFormat
    headerParts.push(`*${formatDate(msg.date, dateFormat)}*`)
  }

  // Message ID
  if (config.includeMessageIds) {
    headerParts.push(`\`#${msg.id}\``)
  }

  // Reply context
  const replyContext = getReplyContext(msg, messageMap, config)
  if (replyContext) {
    headerParts.push(`> ${replyContext}`)
  }

  // Header line
  if (headerParts.length > 0) {
    lines.push(headerParts.join(' '))
  }

  // Forwarded
  if (msg.forwardedFrom) {
    lines.push(`> Forwarded from ${msg.forwardedFrom}`)
  }

  // Content
  const mediaPlaceholder = getMediaPlaceholder(msg, config)
  if (mediaPlaceholder) {
    lines.push(mediaPlaceholder)
  }
  if (msg.text) {
    lines.push(msg.text)
  }

  return lines
}

/**
 * Format messages as Markdown
 */
function formatAsMarkdown(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig
): string {
  const prepared = prepareMessages(messages, config)
  const messageMap = buildMessageMap(messages)

  const lines: string[] = []

  // Header
  lines.push(`# ${chatExport.chatTitle}`)
  lines.push('')
  lines.push(`*${prepared.length} messages*`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // Check if using per-day grouping
  if (config.dateGrouping === 'per-day' && config.includeDate) {
    const dayGroups = groupMessagesByDay(prepared)

    for (const [dateKey, dayMessages] of dayGroups) {
      // Add day header
      const dayDate = new Date(dateKey + 'T00:00:00')
      lines.push(`## ${formatDayHeader(dayDate)}`)
      lines.push('')

      // Add messages for this day
      for (const msg of dayMessages) {
        const msgLines = formatSingleMessageMarkdown(msg, config, messageMap, true)
        lines.push(...msgLines)
        lines.push('')
      }
    }
  } else {
    // Original per-message behavior
    for (const msg of prepared) {
      const msgLines = formatSingleMessageMarkdown(msg, config, messageMap, true)
      lines.push(...msgLines)
      lines.push('')
    }
  }

  return lines.join('\n').trim()
}

/**
 * Format messages using a custom template
 *
 * Template variables:
 * - {{chat_title}} - Chat title
 * - {{message_count}} - Number of messages
 * - {{messages}} - Formatted messages block
 *
 * Per-message variables (used within {{#each messages}}...{{/each}}):
 * - {{sender}} - Sender name/username
 * - {{date}} - Formatted date
 * - {{id}} - Message ID
 * - {{text}} - Message text
 * - {{media}} - Media placeholder
 * - {{reply}} - Reply context
 * - {{forward}} - Forward info
 */
function formatAsCustom(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig
): string {
  const template =
    config.customTemplate || '{{chat_title}}\n\n{{#each messages}}{{sender}}: {{text}}\n{{/each}}'
  const prepared = prepareMessages(messages, config)
  const messageMap = buildMessageMap(messages)

  // Build messages string
  const eachMatch = template.match(/\{\{#each messages\}\}([\s\S]*?)\{\{\/each\}\}/)

  if (!eachMatch) {
    // No each block, just replace global variables
    return template
      .replace(/\{\{chat_title\}\}/g, chatExport.chatTitle)
      .replace(/\{\{message_count\}\}/g, String(prepared.length))
      .replace(/\{\{messages\}\}/g, prepared.map((m) => m.text || '').join('\n'))
  }

  const messageTemplate = eachMatch[1] || ''
  const formattedMessages = prepared
    .map((msg) => {
      let result = messageTemplate

      const sender = buildSenderString(msg, config)
      const dateStr = config.includeDate ? formatDate(msg.date, config.dateFormat) : ''
      const replyContext = getReplyContext(msg, messageMap, config)
      const mediaPlaceholder = getMediaPlaceholder(msg, config)

      result = result.replace(/\{\{sender\}\}/g, sender)
      result = result.replace(/\{\{date\}\}/g, dateStr)
      result = result.replace(/\{\{id\}\}/g, String(msg.id))
      result = result.replace(/\{\{text\}\}/g, msg.text || '')
      result = result.replace(/\{\{media\}\}/g, mediaPlaceholder)
      result = result.replace(/\{\{reply\}\}/g, replyContext || '')
      result = result.replace(/\{\{forward\}\}/g, msg.forwardedFrom || '')

      return result
    })
    .join('')

  // Replace the each block with formatted messages
  let output = template.replace(/\{\{#each messages\}\}[\s\S]*?\{\{\/each\}\}/, formattedMessages)

  // Replace global variables
  output = output.replace(/\{\{chat_title\}\}/g, chatExport.chatTitle)
  output = output.replace(/\{\{message_count\}\}/g, String(prepared.length))

  return output
}

// =============================================================================
// Main Export Function
// =============================================================================

/**
 * Format messages according to the specified configuration
 *
 * This is a pure function with no side effects.
 * It transforms messages + config into a formatted string.
 */
export function formatMessages(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig
): string {
  switch (config.template) {
    case 'xml':
      return formatAsXml(messages, chatExport, config)
    case 'plain':
      return formatAsPlain(messages, chatExport, config)
    case 'json':
      return formatAsJson(messages, chatExport, config)
    case 'markdown':
      return formatAsMarkdown(messages, chatExport, config)
    case 'custom':
      return formatAsCustom(messages, chatExport, config)
    default:
      return formatAsPlain(messages, chatExport, config)
  }
}

/**
 * Get a preview of the formatted output (limited to first N messages)
 */
export function formatPreview(
  messages: ChatMessage[],
  chatExport: ChatExport,
  config: FormatConfig,
  previewLimit: number = 10
): string {
  const previewConfig: FormatConfig = {
    ...config,
    messageLimit:
      config.messageLimit > 0 ? Math.min(config.messageLimit, previewLimit) : previewLimit,
  }

  return formatMessages(messages, chatExport, previewConfig)
}

/**
 * Estimate the output size in characters
 */
export function estimateOutputSize(
  messages: ChatMessage[],
  _chatExport: ChatExport,
  config: FormatConfig
): number {
  // Quick estimate based on message count and average message length
  const avgMessageLength =
    messages.reduce((sum, m) => sum + (m.text?.length || 0), 0) / messages.length || 50
  const overhead = config.template === 'xml' ? 100 : config.template === 'json' ? 80 : 30

  const effectiveCount =
    config.messageLimit > 0 ? Math.min(messages.length, config.messageLimit) : messages.length

  return effectiveCount * (avgMessageLength + overhead)
}

/**
 * Get template description for UI
 */
export function getTemplateDescription(template: FormatTemplate): string {
  switch (template) {
    case 'xml':
      return 'XML format optimized for Claude and other LLMs that prefer structured markup'
    case 'plain':
      return 'Simple plain text format, easy to read and universally compatible'
    case 'json':
      return 'JSON format for programmatic processing or API integration'
    case 'markdown':
      return 'Markdown format with headers and formatting, good for documentation'
    case 'custom':
      return 'Define your own template with variables like {{sender}}, {{text}}, {{date}}'
    default:
      return ''
  }
}

/**
 * Get example output for a template
 */
export function getTemplateExample(template: FormatTemplate): string {
  switch (template) {
    case 'xml':
      return `<conversation chat="Family Group" messages="3">
  <message from="Alice" date="Jan 10">Hello everyone!</message>
  <message from="Bob" reply="Alice">Hey! How are you?</message>
</conversation>`
    case 'plain':
      return `[Family Group - 3 messages]

Alice (Jan 10):
Hello everyone!

Bob [reply to Alice]:
Hey! How are you?`
    case 'json':
      return `{
  "chat": "Family Group",
  "messages": [
    {"from": "Alice", "date": "Jan 10", "text": "Hello everyone!"},
    {"from": "Bob", "reply_to": "Alice", "text": "Hey! How are you?"}
  ]
}`
    case 'markdown':
      return `# Family Group

**Alice** *Jan 10*
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
