import type {
  ChatExport,
  ChatHistoryResult,
  ChatMessage,
  CommitOptions,
  SavedAccount,
} from '@/types'
import { getMarkedPeerIdForChat } from '@/utils/telegram-peers'
import * as db from '../storage/indexed-db'
import {
  archiveOwnership,
  canAccessContent,
  canManageRecord,
  claimOwnership,
  isLegacyClaimable,
  isOwnedByAccount,
  isVisibleToAccount,
  type NormalizedOwnership,
  normalizeOwnership,
  recoverOwnership,
  recoveryChannelForAccount,
  toStoredOwnership,
} from '../storage/record-ownership'

const CURRENT_LLM_EXPORT_SCHEMA_VERSION = 2

/** Overlay a normalized ownership onto a chat export, setting every ownership field explicitly. */
function applyChatExportOwnership(
  chatExport: ChatExport,
  ownership: NormalizedOwnership,
): ChatExport {
  return {
    ...chatExport,
    ...toStoredOwnership(ownership),
    ownerAccountId: ownership.ownerAccountId,
    ownerAccountPhone: ownership.ownerAccountPhone,
    ownerPrincipal: ownership.ownerPrincipal,
    archivedAt: ownership.archivedAt,
    archivedReason: ownership.archivedReason,
    quarantineReason: ownership.quarantineReason,
  }
}

function normalizeChatExport(chatExport: ChatExport): ChatExport {
  const withDefaults: ChatExport = {
    ...chatExport,
    chatPeerId:
      chatExport.chatPeerId || getMarkedPeerIdForChat(chatExport.chatId, chatExport.chatType),
    hasMedia: chatExport.hasMedia ?? (chatExport.mediaCount ?? 0) > 0,
    mediaCount: chatExport.mediaCount ?? 0,
    schemaVersion: CURRENT_LLM_EXPORT_SCHEMA_VERSION,
  }

  return applyChatExportOwnership(withDefaults, normalizeOwnership(withDefaults))
}

function isChatExportVisibleToAccount(
  chatExport: ChatExport,
  account: SavedAccount | null,
): boolean {
  if (!account || account.type !== 'user') {
    return false
  }

  return isVisibleToAccount(chatExport, account)
}

function sortChatExportsByCreatedAt(chatExports: ChatExport[]): ChatExport[] {
  return chatExports.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
}

function sortArchivedChatExports(chatExports: ChatExport[]): ChatExport[] {
  return chatExports.sort((left, right) => {
    const leftDate = left.archivedAt ?? left.createdAt
    const rightDate = right.archivedAt ?? right.createdAt
    return rightDate.getTime() - leftDate.getTime()
  })
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
  options?: CommitOptions,
): Promise<ChatHistoryResult> {
  const normalizedExport = normalizeChatExport(chatExport)
  const normalizedMessages = messages.map((message) =>
    normalizeChatMessage(normalizedExport, message),
  )

  // Fence immediately before the write so a removed account cannot leave an orphaned owned export.
  options?.ensureCommittable?.()
  await db.saveChatExportBundle(normalizedExport, normalizedMessages)

  return {
    chatExport: normalizedExport,
    messages: normalizedMessages,
  }
}

/**
 * Read a chat export and its messages. `accessor` is the account context requesting the read; content
 * is returned only when that account owns the record (or it is unclaimed legacy). Archived,
 * quarantined, and other-owner exports return null so an unrelated active account can never read
 * another principal's content.
 */
export async function loadChatExportBundle(
  exportId: string,
  accessor: SavedAccount | null,
): Promise<ChatHistoryResult | null> {
  const chatExport = await db.getChatExport(exportId)
  if (!chatExport) {
    return null
  }

  if (!canAccessContent(chatExport, accessor)) {
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
  return sortChatExportsByCreatedAt(chatExports.map(normalizeChatExport))
}

/**
 * Pure lifecycle read: return the chat exports visible to `account` without mutating anything.
 * Archive recovery is a separate, explicitly triggered lifecycle step (see
 * `recoverArchivedChatExportsForAccount`, driven from the accounts store on add/activation) so a list
 * call never races a concurrent recovery mutation.
 */
export async function listChatExportsForAccount(
  account: SavedAccount | null,
): Promise<ChatExport[]> {
  if (!account || account.type !== 'user') {
    return []
  }

  const chatExports = await listChatExports()
  return chatExports.filter((chatExport) => isChatExportVisibleToAccount(chatExport, account))
}

export async function listArchivedChatExports(): Promise<ChatExport[]> {
  const chatExports = await listChatExports()
  return sortArchivedChatExports(
    chatExports.filter((chatExport) => normalizeOwnership(chatExport).lifecycle === 'archived'),
  )
}

/** Exports whose owner metadata is missing or inconsistent; surfaced for explicit repair. */
export async function listQuarantinedChatExports(): Promise<ChatExport[]> {
  const chatExports = await listChatExports()
  return chatExports.filter((chatExport) => normalizeOwnership(chatExport).health === 'quarantined')
}

/**
 * Delete a chat export. `accessor` is the account context requesting the deletion; the owner may
 * delete their own records and orphaned records (archived/quarantined/legacy) are manageable
 * account-independently (`accessor` null), but an active export owned by a different principal is
 * protected.
 */
export async function deleteChatExport(
  exportId: string,
  accessor: SavedAccount | null,
): Promise<void> {
  const chatExport = await db.getChatExport(exportId)
  if (!chatExport) {
    return
  }

  if (!canManageRecord(chatExport, accessor)) {
    throw new Error('Not authorized to delete this chat export')
  }

  await db.deleteChatExport(exportId)
}

/**
 * Explicit repair: bind a quarantined or legacy export to `account`. This is a deliberate user
 * action for ambiguous records — it never runs automatically.
 */
export async function reconcileChatExport(
  exportId: string,
  account: SavedAccount,
): Promise<ChatExport> {
  if (account.type !== 'user') {
    throw new Error('Only user accounts can reconcile chat exports')
  }

  const storedChatExport = await db.getChatExport(exportId)
  if (!storedChatExport) {
    throw new Error('Chat export not found')
  }

  const ownership = normalizeOwnership(storedChatExport)
  if (ownership.health !== 'quarantined' && ownership.verification !== 'legacy') {
    throw new Error('Only quarantined or legacy chat exports can be reconciled')
  }

  const reconciledChatExport = applyChatExportOwnership(
    normalizeChatExport(storedChatExport),
    claimOwnership(ownership, account),
  )

  await db.saveChatExport(reconciledChatExport)

  return normalizeChatExport(reconciledChatExport)
}

export async function claimLegacyChatExport(
  exportId: string,
  account: SavedAccount,
): Promise<ChatExport> {
  if (account.type !== 'user') {
    throw new Error('Only user accounts can claim chat exports')
  }

  const storedChatExport = await db.getChatExport(exportId)
  if (!storedChatExport) {
    throw new Error('Chat export not found')
  }

  if (!isLegacyClaimable(storedChatExport)) {
    throw new Error('Only legacy chat exports can be claimed')
  }

  const claimedChatExport = applyChatExportOwnership(
    normalizeChatExport(storedChatExport),
    claimOwnership(normalizeOwnership(storedChatExport), account),
  )

  await db.saveChatExport(claimedChatExport)

  return normalizeChatExport(claimedChatExport)
}

export async function getChatMessages(
  exportId: string,
  accessor: SavedAccount | null,
): Promise<ChatMessage[]> {
  const result = await loadChatExportBundle(exportId, accessor)
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
  const ownedExports = chatExports.filter((chatExport) => isOwnedByAccount(chatExport, account))

  await Promise.all(
    ownedExports.map((chatExport) =>
      db.saveChatExport(
        applyChatExportOwnership(chatExport, archiveOwnership(normalizeOwnership(chatExport))),
      ),
    ),
  )

  return ownedExports.length
}

export async function recoverArchivedChatExportsForAccount(account: SavedAccount): Promise<number> {
  if (account.type !== 'user') {
    return 0
  }

  const chatExports = await listChatExports()
  const recoverable = chatExports
    .map((chatExport) => ({ chatExport, channel: recoveryChannelForAccount(chatExport, account) }))
    .filter((entry) => entry.channel !== null)

  await Promise.all(
    recoverable.map(({ chatExport, channel }) =>
      db.saveChatExport(
        applyChatExportOwnership(
          chatExport,
          recoverOwnership(normalizeOwnership(chatExport), account, channel!),
        ),
      ),
    ),
  )

  return recoverable.length
}
