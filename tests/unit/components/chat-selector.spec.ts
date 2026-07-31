import { describe, expect, it } from 'vitest'
import {
  countChatsByCategory,
  filterAndSortChats,
  getEligibleChats,
  isPublicChat,
  type ChatSelectorQuery,
} from '@/components/telegram/chat-selector'
import type { ChatInfo } from '@/types'

function createChat(id: number, overrides: Partial<ChatInfo> = {}): ChatInfo {
  return {
    id: BigInt(id),
    title: `Chat ${id}`,
    type: 'user',
    canExport: false,
    canSend: true,
    isAdmin: false,
    ...overrides,
  }
}

const chats: ChatInfo[] = [
  createChat(1, {
    title: 'Alice',
    username: 'alice',
    lastMessageDate: new Date('2026-01-04T00:00:00Z'),
  }),
  createChat(2, {
    title: 'Private Group',
    type: 'group',
    lastMessageDate: new Date('2026-01-02T00:00:00Z'),
    participantCount: 4,
  }),
  createChat(3, {
    title: 'Public Builders',
    type: 'supergroup',
    username: 'builders',
    canExport: true,
    isAdmin: true,
    lastMessageDate: new Date('2026-01-03T00:00:00Z'),
    participantCount: 400,
  }),
  createChat(4, {
    title: 'News Channel',
    type: 'channel',
    username: 'news',
    canExport: true,
    canSend: false,
    isAdmin: true,
    lastMessageDate: new Date('2026-01-01T00:00:00Z'),
    participantCount: 2_000,
  }),
]

function query(overrides: Partial<ChatSelectorQuery> = {}): ChatSelectorQuery {
  return {
    search: '',
    categories: ['direct', 'groups', 'channels'],
    publicOnly: false,
    adminOnly: false,
    sendableOnly: false,
    selectedOnly: false,
    selectedIds: new Set(),
    sort: 'recent',
    locale: 'en',
    ...overrides,
  }
}

describe('chat selector filtering', () => {
  it('applies tool constraints before user filters', () => {
    expect(
      getEligibleChats(chats, {
        allowedTypes: ['supergroup', 'channel'],
        requiredCapabilities: ['canExport', 'isAdmin'],
      }).map((chat) => chat.title),
    ).toEqual(['Public Builders', 'News Channel'])

    expect(
      filterAndSortChats(chats, query({ sendableOnly: true }), {
        requiredCapabilities: ['canExport'],
      }).map((chat) => chat.title),
    ).toEqual(['Public Builders'])
  })

  it('combines category, public, selected, and search filters', () => {
    expect(isPublicChat(chats[0]!)).toBe(false)
    expect(isPublicChat(chats[2]!)).toBe(true)

    const result = filterAndSortChats(
      chats,
      query({
        categories: ['groups', 'channels'],
        publicOnly: true,
        adminOnly: true,
        selectedOnly: true,
        selectedIds: new Set(['3']),
        search: '@BUILD',
      }),
    )

    expect(result.map((chat) => chat.title)).toEqual(['Public Builders'])
  })

  it('supports recent, name, type, and member-count sorting', () => {
    expect(filterAndSortChats(chats, query()).map((chat) => chat.title)).toEqual([
      'Alice',
      'Public Builders',
      'Private Group',
      'News Channel',
    ])
    expect(filterAndSortChats(chats, query({ sort: 'name' })).map((chat) => chat.title)).toEqual([
      'Alice',
      'News Channel',
      'Private Group',
      'Public Builders',
    ])
    expect(filterAndSortChats(chats, query({ sort: 'type' })).map((chat) => chat.title)).toEqual([
      'Alice',
      'Private Group',
      'Public Builders',
      'News Channel',
    ])
    expect(filterAndSortChats(chats, query({ sort: 'members' })).map((chat) => chat.title)).toEqual([
      'News Channel',
      'Public Builders',
      'Private Group',
      'Alice',
    ])
  })

  it('counts only chats eligible for the tool', () => {
    expect(countChatsByCategory(chats, { requiredCapabilities: ['canSend'] })).toEqual({
      direct: 1,
      groups: 2,
      channels: 0,
    })
  })
})
