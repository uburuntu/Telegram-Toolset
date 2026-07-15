export interface ScheduledMessageSelection {
  chatId: bigint
  messageId: number
}

export function getScheduledMessageSelectionKey(chatId: bigint, messageId: number): string {
  return `${chatId}:${messageId}`
}

export function groupScheduledMessageSelections(
  selections: Iterable<ScheduledMessageSelection>,
): Map<bigint, number[]> {
  const messagesByChat = new Map<bigint, number[]>()

  for (const { chatId, messageId } of selections) {
    const messageIds = messagesByChat.get(chatId)
    if (messageIds) {
      messageIds.push(messageId)
    } else {
      messagesByChat.set(chatId, [messageId])
    }
  }

  return messagesByChat
}
