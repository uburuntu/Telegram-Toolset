import type { ChatInfo } from '@/types'

export const CHAT_CATEGORIES = ['direct', 'groups', 'channels'] as const
export const CHAT_SORTS = ['recent', 'name', 'type', 'members'] as const

export type ChatCategory = (typeof CHAT_CATEGORIES)[number]
export type ChatSort = (typeof CHAT_SORTS)[number]
export type ChatSelectorMode = 'single' | 'multiple'
export type ChatCapability = 'canExport' | 'canSend' | 'isAdmin'
export type ChatSelectorDensity = 'compact' | 'comfortable'
export type ChatSelectorHeight = 'sm' | 'md' | 'lg'

export interface ChatSelectorFilterOptions {
  categories: boolean
  publicOnly: boolean
  adminOnly: boolean
  sendableOnly: boolean
  selectedOnly: boolean
}

export interface ChatSelectorDisplayOptions {
  search: boolean
  sort: boolean
  resultCount: boolean
  selectedCount: boolean
  selectVisible: boolean
  username: boolean
  lastActivity: boolean
  participants: boolean
  badges: boolean
  density: ChatSelectorDensity
  maxHeight: ChatSelectorHeight
}

/** Tool-owned constraints and presentation choices for the shared chat selector. */
export interface ChatSelectorConfig {
  mode?: ChatSelectorMode
  allowedTypes?: readonly ChatInfo['type'][]
  requiredCapabilities?: readonly ChatCapability[]
  filters?: Partial<ChatSelectorFilterOptions>
  display?: Partial<ChatSelectorDisplayOptions>
  sortOptions?: readonly ChatSort[]
  defaultSort?: ChatSort
  defaultCategories?: readonly ChatCategory[]
  maxSelections?: number
}

/** Optional tool-specific copy. Unset values use the shared translations. */
export interface ChatSelectorLabels {
  title?: string
  searchPlaceholder?: string
  loading?: string
  emptyTitle?: string
  emptyDescription?: string
  noResults?: string
  retry?: string
}

export interface ChatSelectorQuery {
  search: string
  categories: readonly ChatCategory[]
  publicOnly: boolean
  adminOnly: boolean
  sendableOnly: boolean
  selectedOnly: boolean
  selectedIds: ReadonlySet<string>
  sort: ChatSort
  locale?: string
}

export interface ChatSelectorConstraints {
  allowedTypes?: readonly ChatInfo['type'][]
  requiredCapabilities?: readonly ChatCapability[]
}

export const DEFAULT_CHAT_SELECTOR_FILTERS: Readonly<ChatSelectorFilterOptions> = Object.freeze({
  categories: true,
  publicOnly: true,
  adminOnly: true,
  sendableOnly: true,
  selectedOnly: true,
})

export const DEFAULT_CHAT_SELECTOR_DISPLAY: Readonly<ChatSelectorDisplayOptions> = Object.freeze({
  search: true,
  sort: true,
  resultCount: true,
  selectedCount: true,
  selectVisible: true,
  username: true,
  lastActivity: true,
  participants: true,
  badges: true,
  density: 'comfortable',
  maxHeight: 'lg',
})

export function getChatCategory(chat: Pick<ChatInfo, 'type'>): ChatCategory {
  switch (chat.type) {
    case 'user':
      return 'direct'
    case 'group':
    case 'supergroup':
      return 'groups'
    case 'channel':
      return 'channels'
  }
}

export function isPublicChat(chat: Pick<ChatInfo, 'type' | 'username'>): boolean {
  return chat.type !== 'user' && Boolean(chat.username)
}

export function getEligibleChats(
  chats: readonly ChatInfo[],
  constraints: ChatSelectorConstraints = {},
): ChatInfo[] {
  const allowedTypes = constraints.allowedTypes
  const requiredCapabilities = constraints.requiredCapabilities ?? []

  return chats.filter((chat) => {
    if (allowedTypes && !allowedTypes.includes(chat.type)) {
      return false
    }

    return requiredCapabilities.every((capability) => chat[capability])
  })
}

export function filterAndSortChats(
  chats: readonly ChatInfo[],
  query: ChatSelectorQuery,
  constraints: ChatSelectorConstraints = {},
): ChatInfo[] {
  const normalizedSearch = query.search.trim().toLocaleLowerCase(query.locale)
  const categories = new Set(query.categories)
  const collator = new Intl.Collator(query.locale, { numeric: true, sensitivity: 'base' })

  return getEligibleChats(chats, constraints)
    .filter((chat) => categories.has(getChatCategory(chat)))
    .filter((chat) => !query.publicOnly || isPublicChat(chat))
    .filter((chat) => !query.adminOnly || chat.isAdmin)
    .filter((chat) => !query.sendableOnly || chat.canSend)
    .filter((chat) => !query.selectedOnly || query.selectedIds.has(chat.id.toString()))
    .filter((chat) => {
      if (!normalizedSearch) return true
      const haystack = [chat.title, chat.username ? `@${chat.username}` : '', chat.type]
        .join(' ')
        .toLocaleLowerCase(query.locale)
      return haystack.includes(normalizedSearch)
    })
    .sort((left, right) => {
      switch (query.sort) {
        case 'recent': {
          const dateDifference =
            (right.lastMessageDate?.getTime() ?? 0) - (left.lastMessageDate?.getTime() ?? 0)
          return dateDifference || collator.compare(left.title, right.title)
        }
        case 'name':
          return collator.compare(left.title, right.title)
        case 'type': {
          const categoryDifference =
            CHAT_CATEGORIES.indexOf(getChatCategory(left)) -
            CHAT_CATEGORIES.indexOf(getChatCategory(right))
          return categoryDifference || collator.compare(left.title, right.title)
        }
        case 'members': {
          const memberDifference = (right.participantCount ?? -1) - (left.participantCount ?? -1)
          return memberDifference || collator.compare(left.title, right.title)
        }
      }

      return 0
    })
}

export function countChatsByCategory(
  chats: readonly ChatInfo[],
  constraints: ChatSelectorConstraints = {},
): Record<ChatCategory, number> {
  const counts: Record<ChatCategory, number> = { direct: 0, groups: 0, channels: 0 }
  for (const chat of getEligibleChats(chats, constraints)) {
    counts[getChatCategory(chat)]++
  }
  return counts
}
