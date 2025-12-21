/**
 * ZIP generation service
 */

import JSZip from 'jszip'
import type { BackupWithMessages } from '@/types'

class ZipGenerator {
  async generateAndDownload(backup: BackupWithMessages): Promise<void> {
    const zip = new JSZip()

    // Create metadata JSON
    const metadata = {
      chatId: backup.chatId.toString(),
      chatTitle: backup.chatTitle,
      chatType: backup.chatType,
      exportDate: backup.createdAt.toISOString(),
      messageCount: backup.messageCount,
      mediaCount: backup.mediaCount,
      exportMode: backup.exportMode,
    }

    zip.file('metadata.json', JSON.stringify(metadata, null, 2))

    // Create messages JSON (with BigInt serialization)
    const messagesData = backup.messages.map((msg) => ({
      ...msg,
      chatId: msg.chatId.toString(),
      senderId: msg.senderId?.toString(),
      date: msg.date.toISOString(),
    }))

    zip.file('messages.json', JSON.stringify(messagesData, null, 2))

    // Add media files
    if (backup.mediaBlobs.size > 0) {
      const mediaFolder = zip.folder('media')
      if (mediaFolder) {
        for (const [messageId, blob] of backup.mediaBlobs) {
          const msg = backup.messages.find((m) => m.id === messageId)
          const ext = this.getExtensionFromMimeType(blob.type)
          const filename = msg?.mediaFilename || `${messageId}${ext}`
          mediaFolder.file(filename, blob)
        }
      }
    }

    // Generate and download
    const content = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    // Create download link
    const url = URL.createObjectURL(content)
    const a = document.createElement('a')
    a.href = url
    a.download = `${this.sanitizeFilename(backup.chatTitle)}_${this.formatDate(backup.createdAt)}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async generateBlob(backup: BackupWithMessages): Promise<Blob> {
    const zip = new JSZip()

    // Add all content
    const metadata = {
      chatId: backup.chatId.toString(),
      chatTitle: backup.chatTitle,
      exportDate: backup.createdAt.toISOString(),
      messageCount: backup.messageCount,
    }

    zip.file('metadata.json', JSON.stringify(metadata, null, 2))

    const messagesData = backup.messages.map((msg) => ({
      ...msg,
      chatId: msg.chatId.toString(),
      senderId: msg.senderId?.toString(),
      date: msg.date.toISOString(),
    }))

    zip.file('messages.json', JSON.stringify(messagesData, null, 2))

    if (backup.mediaBlobs.size > 0) {
      const mediaFolder = zip.folder('media')
      if (mediaFolder) {
        for (const [messageId, blob] of backup.mediaBlobs) {
          const ext = this.getExtensionFromMimeType(blob.type)
          mediaFolder.file(`${messageId}${ext}`, blob)
        }
      }
    }

    return zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 100)
  }

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0] ?? ''
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'video/webm': '.webm',
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'application/pdf': '.pdf',
    }
    return map[mimeType] || ''
  }
}

// Singleton instance
export const zipGenerator = new ZipGenerator()
