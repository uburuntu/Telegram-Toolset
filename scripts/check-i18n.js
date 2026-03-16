#!/usr/bin/env node
/**
 * Validates vue-i18n locale files and Vue components.
 *
 * Errors (blocking):
 *   - Unescaped special characters (@, {{) that cause silent runtime crashes
 *
 * Warnings (non-blocking):
 *   - Keys present in en.json but missing from other locales
 *   - Hardcoded user-visible strings in Vue templates (should use t())
 *
 * See: https://vue-i18n.intlify.dev/guide/essentials/syntax#literal-interpolation
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const LOCALES_DIR = join(import.meta.dirname, '..', 'src', 'i18n', 'locales')
const SRC_DIR = join(import.meta.dirname, '..', 'src')
const REFERENCE_LOCALE = 'en.json'

// ---------------------------------------------------------------------------
// 1. Special character validation (errors — blocks CI)
// ---------------------------------------------------------------------------

const SPECIAL_CHAR_RULES = [
  {
    name: 'unescaped @',
    test: (value) => {
      const cleaned = value.replace(/\{'[^']*'\}/g, '')
      const noUrls = cleaned.replace(/https?:\/\/\S+/g, '')
      return /@(?![:.])/.test(noUrls)
    },
    hint: "Use {'@'} for literal @ characters",
  },
  {
    name: 'unescaped {{ (double brace)',
    test: (value) => {
      const cleaned = value.replace(/\{'[^']*'\}/g, '')
      return /\{\{/.test(cleaned)
    },
    hint: 'Avoid {{ in i18n values — rewrite text to describe braces instead of showing them',
  },
]

let errors = 0
const localeFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'))

for (const file of localeFiles) {
  const path = join(LOCALES_DIR, file)
  const data = JSON.parse(readFileSync(path, 'utf-8'))

  function checkSpecialChars(obj, keyPath) {
    if (typeof obj === 'string') {
      for (const rule of SPECIAL_CHAR_RULES) {
        if (rule.test(obj)) {
          console.error(`ERROR: ${file} ${keyPath}: ${rule.name}`)
          console.error(`  Value: ${obj.length > 100 ? `${obj.slice(0, 100)}...` : obj}`)
          console.error(`  Fix: ${rule.hint}`)
          console.error()
          errors++
        }
      }
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, val] of Object.entries(obj)) {
        checkSpecialChars(val, keyPath ? `${keyPath}.${key}` : key)
      }
    }
  }

  checkSpecialChars(data, '')
}

// ---------------------------------------------------------------------------
// 2. Missing translation keys (warnings — does not block CI)
// ---------------------------------------------------------------------------

function flattenKeys(obj, prefix = '') {
  const keys = []
  for (const [key, val] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof val === 'object' && val !== null) {
      keys.push(...flattenKeys(val, fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

const refPath = join(LOCALES_DIR, REFERENCE_LOCALE)
const refData = JSON.parse(readFileSync(refPath, 'utf-8'))
const refKeys = flattenKeys(refData)

let warnings = 0

for (const file of localeFiles) {
  if (file === REFERENCE_LOCALE) continue

  const path = join(LOCALES_DIR, file)
  const data = JSON.parse(readFileSync(path, 'utf-8'))
  const localeKeys = new Set(flattenKeys(data))
  const missing = refKeys.filter((k) => !localeKeys.has(k))

  if (missing.length > 0) {
    console.warn(`WARNING: ${file} is missing ${missing.length} key(s) from ${REFERENCE_LOCALE}:`)
    for (const key of missing) {
      console.warn(`  - ${key}`)
    }
    console.warn()
    warnings += missing.length
  }
}

// ---------------------------------------------------------------------------
// 3. Hardcoded strings in Vue templates (warnings — does not block CI)
// ---------------------------------------------------------------------------

// Matches text content between HTML tags that contains 2+ word characters,
// excluding Vue interpolation {{ }}, directives, comments, and common false positives.
const HARDCODED_TEXT_RE =
  />([^<]*[a-zA-Z]{2,}[^<]*)</g

// Strings that are OK to hardcode (not user-visible or universal)
const ALLOWED_HARDCODED = new Set([
  'Telegram Toolset',
  'XML',
  'JSON',
  'Markdown',
  'ISO 8601',
  'API ID',
  'API Hash',
  '2FA',
  'IndexedDB',
  'MTProto',
  // Timezone labels are universal
  'UTC',
  'London (GMT/BST)',
  'Paris (CET/CEST)',
  'Moscow (MSK)',
  'New York (EST/EDT)',
  'Los Angeles (PST/PDT)',
  'Tokyo (JST)',
  'Shanghai (CST)',
  'Dubai (GST)',
  'Sydney (AEST/AEDT)',
])

function findVueFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...findVueFiles(fullPath))
    } else if (entry.name.endsWith('.vue')) {
      results.push(fullPath)
    }
  }
  return results
}

function extractTemplate(content) {
  const match = content.match(/<template>([\s\S]*)<\/template>/)
  return match ? match[1] : ''
}

let hardcodedCount = 0

for (const file of findVueFiles(SRC_DIR)) {
  const content = readFileSync(file, 'utf-8')
  const template = extractTemplate(content)
  if (!template) continue

  const lines = template.split('\n')
  const relPath = file.replace(join(SRC_DIR, '..') + '/', '')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip lines that are comments, directives, or contain only interpolation
    if (line.trim().startsWith('<!--')) continue
    if (line.trim().startsWith('//')) continue

    // Find text content between tags
    let match
    HARDCODED_TEXT_RE.lastIndex = 0
    while ((match = HARDCODED_TEXT_RE.exec(line)) !== null) {
      const text = match[1].trim()

      // Skip empty or whitespace-only
      if (!text || !/[a-zA-Z]{2,}/.test(text)) continue

      // Skip if it's just Vue interpolation like {{ t('...') }}
      if (/^\s*\{\{.*\}\}\s*$/.test(text)) continue

      // Skip if it contains interpolation mixed with static (partial translations are OK)
      if (/\{\{/.test(text)) continue

      // Skip allowed strings
      if (ALLOWED_HARDCODED.has(text)) continue

      // Skip single-word CSS classes, HTML attributes, or technical strings
      if (/^[a-z][-a-z0-9]*$/.test(text)) continue

      // Skip emoji-only content
      if (/^[\p{Emoji}\s]+$/u.test(text)) continue

      // Offset by template start line in the file
      const templateStart = content.substring(0, content.indexOf('<template>')).split('\n').length
      const lineNum = templateStart + i

      console.warn(`WARNING: ${relPath}:${lineNum} hardcoded text: "${text}"`)
      hardcodedCount++
    }
  }
}

if (hardcodedCount > 0) {
  console.warn(`\n${hardcodedCount} hardcoded string(s) found in templates (non-blocking).`)
  warnings += hardcodedCount
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

if (errors > 0) {
  console.error(`\nFAILED: ${errors} escaping error(s). See AGENTS.md for escaping rules.`)
}
if (warnings > 0 && errors === 0) {
  console.warn(`\n${warnings} warning(s) total (non-blocking).`)
}
if (errors === 0 && warnings === 0) {
  console.log(`All ${localeFiles.length} locale files OK — no errors, no missing keys, no hardcoded strings.`)
} else if (errors === 0) {
  console.log(`${localeFiles.length} locale files passed escaping checks.`)
}

process.exit(errors > 0 ? 1 : 0)
