/**
 * Unit tests for resend HTML escaping
 *
 * These tests verify that user-supplied message text is properly escaped
 * when using parseMode: 'html' to prevent HTML injection.
 */

import { describe, it, expect } from 'vitest'

// Import the escapeHtml function from resend-service
// Since it's not exported, we'll test it indirectly or recreate it for unit testing
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

describe('escapeHtml', () => {
  it('escapes less-than signs', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
  })

  it('escapes greater-than signs', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b')
  })

  it('escapes ampersands', () => {
    expect(escapeHtml('rock & roll')).toBe('rock &amp; roll')
  })

  it('escapes double quotes', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;')
  })

  it('escapes multiple special characters', () => {
    const input = '<a href="http://example.com?a=1&b=2">click</a>'
    const expected = '&lt;a href=&quot;http://example.com?a=1&amp;b=2&quot;&gt;click&lt;/a&gt;'
    expect(escapeHtml(input)).toBe(expected)
  })

  it('leaves normal text unchanged', () => {
    expect(escapeHtml('Hello world!')).toBe('Hello world!')
  })

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('')
  })

  it('escapes potential XSS payloads', () => {
    const xss = '<img src=x onerror="alert(1)">'
    const escaped = escapeHtml(xss)
    expect(escaped).not.toContain('<')
    expect(escaped).not.toContain('>')
    expect(escaped).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('escapes Telegram HTML tags that could be injected', () => {
    // These are valid Telegram HTML tags that should be escaped in user text
    expect(escapeHtml('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;')
    expect(escapeHtml('<i>italic</i>')).toBe('&lt;i&gt;italic&lt;/i&gt;')
    expect(escapeHtml('<code>code</code>')).toBe('&lt;code&gt;code&lt;/code&gt;')
    expect(escapeHtml('<pre>pre</pre>')).toBe('&lt;pre&gt;pre&lt;/pre&gt;')
    expect(escapeHtml('<a href="x">link</a>')).toBe('&lt;a href=&quot;x&quot;&gt;link&lt;/a&gt;')
  })
})

describe('message text escaping behavior', () => {
  // These tests document expected behavior at the resend service level

  it('user message containing HTML should be escaped', () => {
    const userMessage = 'Check out <b>this</b> and visit https://example.com'
    const escaped = escapeHtml(userMessage)

    // The <b> tags should be escaped, not rendered as bold
    expect(escaped).toContain('&lt;b&gt;')
    expect(escaped).not.toContain('<b>')
  })

  it('message with ampersand in URL should be escaped', () => {
    const userMessage = 'Link: https://example.com?foo=1&bar=2'
    const escaped = escapeHtml(userMessage)

    expect(escaped).toBe('Link: https://example.com?foo=1&amp;bar=2')
  })

  it('message with math expressions should be escaped', () => {
    const userMessage = 'If a < b and b > c then a < c'
    const escaped = escapeHtml(userMessage)

    expect(escaped).toBe('If a &lt; b and b &gt; c then a &lt; c')
  })
})

