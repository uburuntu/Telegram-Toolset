import type { ChatExport, ChatHistoryResult, ChatMessage } from '@/types'
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
  }
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
