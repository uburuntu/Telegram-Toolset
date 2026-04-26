import type { ChatExport, ChatHistoryResult, ChatMessage, SavedAccount } from '@/types'
import { getMarkedPeerIdForChat } from '@/utils/telegram-peers'
import * as db from '../storage/indexed-db'

const CURRENT_LLM_EXPORT_SCHEMA_VERSION = 2

function normalizeChatExport(chatExport: ChatExport): ChatExport {
  return {
    ...chatExport,
    chatPeerId:
      chatExport.chatPeerId || getMarkedPeerIdForChat(chatExport.chatId, chatExport.chatType),
    hasMedia: chatExport.hasMedia ?? (chatExport.mediaCount ?? 0) > 0,
    mediaCount: chatExport.mediaCount ?? 0,
    schemaVersion: CURRENT_LLM_EXPORT_SCHEMA_VERSION,
    ownershipState: chatExport.ownershipState ?? (chatExport.ownerAccountId ? 'owned' : 'legacy'),
    archivedAt:
      chatExport.archivedAt && !(chatExport.archivedAt instanceof Date)
        ? new Date(chatExport.archivedAt)
        : chatExport.archivedAt,
  }
}

function isChatExportVisibleToAccount(
  chatExport: ChatExport,
  account: SavedAccount | null,
): boolean {
  if (!account || account.type !== 'user') {
    return false
  }

  if (chatExport.ownershipState === 'legacy') {
    return true
  }

  return chatExport.ownershipState === 'owned' && chatExport.ownerAccountId === account.id
}

function normalizeChatMessage(chatExport: ChatExport, message: ChatMessage): ChatMessage {
  return {
    ...message,
    chatPeerId: message.chatPeerId || chatExport.chatPeerId,
    senderOriginalName: message.senderOriginalName || message.senderName,
  }
}

export async function saveChatExportBundle(
  chatExport: ChatExport,
  messages: ChatMessage[],
): Promise<ChatHistoryResult> {
  const normalizedExport = normalizeChatExport(chatExport)
  const normalizedMessages = messages.map((message) =>
    normalizeChatMessage(normalizedExport, message),
  )

  await db.saveChatExportBundle(normalizedExport, normalizedMessages)

  return {
    chatExport: normalizedExport,
    messages: normalizedMessages,
  }
}

export async function loadChatExportBundle(exportId: string): Promise<ChatHistoryResult | null> {
  const chatExport = await db.getChatExport(exportId)
  if (!chatExport) {
    return null
  }

  const normalizedExport = normalizeChatExport(chatExport)
  const messages = (await db.getChatMessagesByExport(exportId)).map((message) =>
    normalizeChatMessage(normalizedExport, message),
  )

  return {
    chatExport: normalizedExport,
    messages,
  }
}

export async function listChatExports(): Promise<ChatExport[]> {
  const chatExports = await db.getAllChatExports()
  return chatExports.map(normalizeChatExport)
}

export async function listChatExportsForAccount(
  account: SavedAccount | null,
): Promise<ChatExport[]> {
  if (!account || account.type !== 'user') {
    return []
  }

  await recoverArchivedChatExportsForAccount(account)

  const chatExports = await listChatExports()
  return chatExports.filter((chatExport) => isChatExportVisibleToAccount(chatExport, account))
}

export async function deleteChatExport(exportId: string): Promise<void> {
  await db.deleteChatExport(exportId)
}

export async function getChatMessages(exportId: string): Promise<ChatMessage[]> {
  const result = await loadChatExportBundle(exportId)
  return result?.messages ?? []
}

export async function getTotalStorageSize(): Promise<number> {
  const chatExports = await listChatExports()
  let totalSize = 0

  for (const chatExport of chatExports) {
    totalSize += await db.getChatExportSize(chatExport.id)
  }

  return totalSize
}

export async function archiveChatExportsForRemovedAccount(account: SavedAccount): Promise<number> {
  if (account.type !== 'user') {
    return 0
  }

  const chatExports = await listChatExports()
  const ownedExports = chatExports.filter(
    (chatExport) =>
      chatExport.ownershipState === 'owned' && chatExport.ownerAccountId === account.id,
  )

  await Promise.all(
    ownedExports.map((chatExport) =>
      db.saveChatExport({
        ...chatExport,
        ownershipState: 'archived',
        archivedAt: new Date(),
        archivedReason: 'account_removed',
        ownerAccountPhone: chatExport.ownerAccountPhone ?? account.phone,
      }),
    ),
  )

  return ownedExports.length
}

export async function recoverArchivedChatExportsForAccount(account: SavedAccount): Promise<number> {
  if (account.type !== 'user' || !account.phone) {
    return 0
  }

  const chatExports = await listChatExports()
  const recoverableExports = chatExports.filter(
    (chatExport) =>
      chatExport.ownershipState === 'archived' && chatExport.ownerAccountPhone === account.phone,
  )

  await Promise.all(
    recoverableExports.map((chatExport) =>
      db.saveChatExport({
        ...chatExport,
        ownerAccountId: account.id,
        ownerAccountPhone: account.phone,
        ownershipState: 'owned',
        archivedAt: undefined,
        archivedReason: undefined,
      }),
    ),
  )

  return recoverableExports.length
}
