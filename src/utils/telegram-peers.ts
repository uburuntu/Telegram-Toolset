import type { ChatInfo, ChatExport } from '@/types'

export type TelegramPeerKind = 'user' | 'chat' | 'channel'

function normalizeNumericId(id: bigint | number | string): string {
  const value = typeof id === 'bigint' ? id.toString() : String(id)
  return value.startsWith('-') ? value.slice(1) : value
}

export function buildMarkedPeerId(kind: TelegramPeerKind, id: bigint | number | string): string {
  const normalizedId = normalizeNumericId(id)

  switch (kind) {
    case 'user':
      return normalizedId
    case 'chat':
      return `-${normalizedId}`
    case 'channel':
      return `-100${normalizedId}`
  }
}

export function parseMarkedPeerId(peerId: bigint | number | string): {
  id: string
  kind: TelegramPeerKind
  markedId: string
} {
  const markedId = typeof peerId === 'bigint' ? peerId.toString() : String(peerId)

  if (!markedId.startsWith('-')) {
    return {
      id: markedId,
      kind: 'user',
      markedId,
    }
  }

  const channelMatch = markedId.match(/^-100([^0]\d*)$/)
  if (channelMatch?.[1]) {
    return {
      id: channelMatch[1],
      kind: 'channel',
      markedId,
    }
  }

  return {
    id: markedId.slice(1),
    kind: 'chat',
    markedId,
  }
}

export function getPeerKindFromChatType(
  chatType: ChatInfo['type'] | ChatExport['chatType'],
): TelegramPeerKind {
  switch (chatType) {
    case 'user':
      return 'user'
    case 'group':
      return 'chat'
    case 'channel':
    case 'supergroup':
      return 'channel'
  }
}

export function getMarkedPeerIdForChat(
  chatId: bigint | number | string,
  chatType: ChatInfo['type'] | ChatExport['chatType'],
): string {
  return buildMarkedPeerId(getPeerKindFromChatType(chatType), chatId)
}

export function normalizeMarkedPeerId(
  peerId?: bigint | number | string | null,
): string | undefined {
  if (peerId === null || peerId === undefined) {
    return undefined
  }

  return parseMarkedPeerId(peerId).markedId
}
