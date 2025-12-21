/**
 * Mock Telegram client for testing
 */

import type { ChatInfo, DeletedMessage, UserInfo } from '@/types'

export const mockUser: UserInfo = {
  id: BigInt('123456789'),
  firstName: 'Test',
  lastName: 'User',
  username: 'testuser',
  phone: '+1234567890',
}

export const mockChats: ChatInfo[] = [
  {
    id: BigInt('-1001234567890'),
    title: 'Test Channel',
    type: 'channel',
    username: 'testchannel',
    canExport: true,
    canSend: false,
    lastMessageDate: new Date('2024-01-15'),
  },
  {
    id: BigInt('-1009876543210'),
    title: 'Test Supergroup',
    type: 'supergroup',
    canExport: true,
    canSend: true,
    lastMessageDate: new Date('2024-01-14'),
  },
  {
    id: BigInt('111222333'),
    title: 'John Doe',
    type: 'user',
    username: 'johndoe',
    canExport: false,
    canSend: true,
    lastMessageDate: new Date('2024-01-13'),
  },
]

export const mockDeletedMessages: DeletedMessage[] = [
  {
    id: 1001,
    chatId: BigInt('-1001234567890'),
    senderId: BigInt('999888777'),
    senderName: 'Alice',
    senderUsername: 'alice',
    text: 'This is a deleted text message',
    date: new Date('2024-01-15T10:30:00'),
    hasMedia: false,
  },
  {
    id: 1002,
    chatId: BigInt('-1001234567890'),
    senderId: BigInt('999888778'),
    senderName: 'Bob',
    text: 'Message with photo',
    date: new Date('2024-01-15T10:35:00'),
    hasMedia: true,
    mediaType: 'photo',
    mediaFilename: 'photo_1002.jpg',
    mediaSize: 102400,
  },
  {
    id: 1003,
    chatId: BigInt('-1001234567890'),
    senderId: BigInt('999888779'),
    senderName: 'Charlie',
    text: 'Video message',
    date: new Date('2024-01-15T10:40:00'),
    hasMedia: true,
    mediaType: 'video',
    mediaFilename: 'video_1003.mp4',
    mediaSize: 5242880,
  },
]

export class MockTelegramClient {
  private _isConnected = false
  private _isAuthorized = false
  
  async connect(): Promise<boolean> {
    this._isConnected = true
    return true
  }

  async isUserAuthorized(): Promise<boolean> {
    return this._isAuthorized
  }

  async sendCode(phone: string): Promise<{ phoneCodeHash: string }> {
    if (!phone.startsWith('+')) {
      throw new Error('Invalid phone number format')
    }
    return { phoneCodeHash: 'mock_hash_123' }
  }

  async signIn(_code: string): Promise<void> {
    this._isAuthorized = true
  }

  async signInWithPassword(_password: string): Promise<void> {
    this._isAuthorized = true
  }

  async getMe(): Promise<UserInfo> {
    return mockUser
  }

  async getDialogs(_limit: number): Promise<ChatInfo[]> {
    return mockChats
  }

  async *iterDeletedMessages(_chatId: bigint): AsyncGenerator<DeletedMessage> {
    for (const msg of mockDeletedMessages) {
      yield msg
    }
  }

  async downloadMedia(_msg: any): Promise<Blob | null> {
    // Return a tiny placeholder image
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: 'image/png' })
  }

  async disconnect(): Promise<void> {
    this._isConnected = false
  }

  // Test helpers
  _setAuthorized(authorized: boolean): void {
    this._isAuthorized = authorized
  }
}

// Export singleton mock instance
export const mockTelegramClient = new MockTelegramClient()

