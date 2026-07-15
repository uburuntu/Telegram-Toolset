#!/usr/bin/env node
/**
 * Validates vue-i18n locale files and user-facing source strings.
 *
 * Errors (blocking):
 *   - Unescaped special characters (@, {{) that cause silent runtime crashes
 *   - Interpolation placeholders that differ from the English reference
 *
 * Warnings (non-blocking):
 *   - Keys present in en.json but missing from other locales
 *   - English-identical values in user-facing namespaces of non-English locales
 *   - Hardcoded user-visible strings in Vue templates
 *   - Hardcoded user-visible strings in TypeScript source
 *
 * See: https://vue-i18n.intlify.dev/guide/essentials/syntax#literal-interpolation
 */

import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import ts from 'typescript'

const ROOT_DIR = join(import.meta.dirname, '..')
const LOCALES_DIR = join(ROOT_DIR, 'src', 'i18n', 'locales')
const SRC_DIR = join(ROOT_DIR, 'src')
const REFERENCE_LOCALE = 'en.json'
const USER_FACING_NAMESPACES = ['common', 'accounts', 'auth']

const IDENTICAL_VALUE_ALLOWED_EXACT = new Set([
  '+1234567890',
  '12345',
  '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
  'API ID',
  'API Hash',
  'Admin',
  'Error',
])

const VUE_ALLOWED_HARDCODED = new Set([
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
  'my.telegram.org',
])

const TS_USER_FACING_PROPERTY_NAMES = new Set([
  'caption',
  'description',
  'heading',
  'helperText',
  'label',
  'message',
  'name',
  'placeholder',
  'subtitle',
  'title',
])

const TS_USER_FACING_FUNCTION_RE = /(Description|Heading|Label|Placeholder|Subtitle|Title)$/
const TS_EXCLUDED_PATH_PREFIXES = ['src/i18n/', 'src/shims/', 'src/types/']
const TS_EXCLUDED_PROPERTY_PATHS_BY_FILE = new Map([
  ['src/modules/index.ts', new Set(['name', 'description'])],
  ['src/services/storage/secure-account-vault.ts', new Set(['name'])],
])
const TS_EXCLUDED_FUNCTIONS_BY_FILE = new Map([
  ['src/services/llm-export/format-service.ts', new Set(['getTemplateDescription'])],
])

// Matches text content between HTML tags that contains 2+ word characters,
// excluding Vue interpolation {{ }}, directives, comments, and common false positives.
const HARDCODED_TEXT_RE = />([^<]*[a-zA-Z]{2,}[^<]*)</g

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function flattenEntries(obj, prefix = '') {
  const entries = []

  for (const [key, val] of Object.entries(obj ?? {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(val)) {
      entries.push(...flattenEntries(val, fullKey))
    } else {
      entries.push([fullKey, val])
    }
  }

  return entries
}

function flattenKeys(obj, prefix = '') {
  return flattenEntries(obj, prefix).map(([key]) => key)
}

function getInterpolationPlaceholders(value) {
  if (typeof value !== 'string') {
    return []
  }

  return [...new Set(Array.from(value.matchAll(/\{([A-Za-z_][\w.-]*|\d+)\}/g), (match) => match[1]))]
    .sort()
}

function getValueAtPath(obj, keyPath) {
  return keyPath.split('.').reduce((current, part) => current?.[part], obj)
}

function findFiles(dir, predicate) {
  const results = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue
    }

    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, predicate))
    } else if (predicate(fullPath, entry.name)) {
      results.push(fullPath)
    }
  }

  return results
}

function toRelPath(file) {
  return relative(ROOT_DIR, file).replaceAll('\\', '/')
}

function formatPreview(value, maxLength = 120) {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}...` : singleLine
}

function shouldWarnOnEnglishIdentical(englishValue) {
  const value = englishValue.trim()

  if (!value) return false
  if (IDENTICAL_VALUE_ALLOWED_EXACT.has(value)) return false
  if (!/[A-Za-z]/.test(value)) return false
  if (/^https?:\/\//.test(value)) return false
  if (/^[\d\s+:/().-]+$/.test(value)) return false

  return true
}

function extractTemplate(content) {
  const match = content.match(/<template>([\s\S]*)<\/template>/)
  return match ? match[1] : ''
}

function getStaticString(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }

  return null
}

function getPropertyNameText(nameNode) {
  if (ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode) || ts.isNumericLiteral(nameNode)) {
    return nameNode.text
  }

  return null
}

function getPropertyPath(node) {
  const parts = []
  let currentProperty = node

  while (currentProperty) {
    const part = getPropertyNameText(currentProperty.name)
    if (!part) break

    parts.unshift(part)

    const parentObject = currentProperty.parent
    if (!ts.isObjectLiteralExpression(parentObject) || !ts.isPropertyAssignment(parentObject.parent)) {
      break
    }

    currentProperty = parentObject.parent
  }

  return parts.join('.')
}

function getEnclosingFunctionName(node) {
  let current = node.parent

  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text
    }

    if (ts.isMethodDeclaration(current) && current.name) {
      return getPropertyNameText(current.name)
    }

    if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      const parent = current.parent
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text
      }
      if (ts.isPropertyAssignment(parent)) {
        return getPropertyNameText(parent.name)
      }
    }

    current = current.parent
  }

  return null
}

function shouldCheckTypeScriptFile(file) {
  const relPath = toRelPath(file)

  if (!relPath.startsWith('src/')) return false
  if (relPath.endsWith('.d.ts')) return false

  return !TS_EXCLUDED_PATH_PREFIXES.some((prefix) => relPath.startsWith(prefix))
}

function looksLikeHardcodedTypeScriptText(value, context = {}) {
  const text = value.trim()
  const { propertyName = '', propertyPath = '' } = context

  if (!text) return false
  if (!/[A-Za-z]/.test(text)) return false
  if (/^https?:\/\//.test(text)) return false
  if (/^[A-Z0-9_]+$/.test(text)) return false
  if (/^[a-z0-9_-]+$/.test(text)) return false
  if (propertyPath === 'route.name') return false
  if (propertyName === 'name' && /^[a-z0-9-]+$/.test(text)) return false

  return true
}

function shouldSkipTypeScriptWarning(file, context = {}) {
  const relPath = toRelPath(file)
  const { propertyPath = '', functionName = '' } = context

  if (propertyPath) {
    const excludedPropertyPaths = TS_EXCLUDED_PROPERTY_PATHS_BY_FILE.get(relPath)
    if (excludedPropertyPaths?.has(propertyPath)) {
      return true
    }
  }

  if (functionName) {
    const excludedFunctions = TS_EXCLUDED_FUNCTIONS_BY_FILE.get(relPath)
    if (excludedFunctions?.has(functionName)) {
      return true
    }
  }

  return false
}

function getLineNumber(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

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
let warnings = 0

const localeFiles = readdirSync(LOCALES_DIR)
  .filter((file) => file.endsWith('.json'))
  .sort()

const localeData = new Map(
  localeFiles.map((file) => [
    file,
    JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf-8')),
  ]),
)

for (const [file, data] of localeData.entries()) {
  function checkSpecialChars(obj, keyPath) {
    if (typeof obj === 'string') {
      for (const rule of SPECIAL_CHAR_RULES) {
        if (rule.test(obj)) {
          console.error(`ERROR: ${file} ${keyPath}: ${rule.name}`)
          console.error(`  Value: ${formatPreview(obj, 100)}`)
          console.error(`  Fix: ${rule.hint}`)
          console.error()
          errors++
        }
      }
    } else if (isPlainObject(obj)) {
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

const refData = localeData.get(REFERENCE_LOCALE)

if (!refData) {
  throw new Error(`Reference locale ${REFERENCE_LOCALE} not found in ${LOCALES_DIR}`)
}

const refKeys = flattenKeys(refData)

for (const [file, data] of localeData.entries()) {
  if (file === REFERENCE_LOCALE) continue

  const localeKeys = new Set(flattenKeys(data))
  const missing = refKeys.filter((key) => !localeKeys.has(key))

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
// 3. Interpolation placeholder parity (errors — blocks CI)
// ---------------------------------------------------------------------------

for (const [file, data] of localeData.entries()) {
  if (file === REFERENCE_LOCALE) continue

  for (const [keyPath, englishValue] of flattenEntries(refData)) {
    if (typeof englishValue !== 'string') continue

    const localeValue = getValueAtPath(data, keyPath)
    if (typeof localeValue !== 'string') continue

    const expected = getInterpolationPlaceholders(englishValue)
    const actual = getInterpolationPlaceholders(localeValue)
    if (expected.join('\0') !== actual.join('\0')) {
      console.error(`ERROR: ${file} ${keyPath}: interpolation placeholders do not match`)
      console.error(`  Expected: ${expected.join(', ') || '(none)'}`)
      console.error(`  Actual:   ${actual.join(', ') || '(none)'}`)
      console.error()
      errors++
    }
  }
}

// ---------------------------------------------------------------------------
// 4. English-identical values in user-facing namespaces (warnings)
// ---------------------------------------------------------------------------

for (const [file, data] of localeData.entries()) {
  if (file === REFERENCE_LOCALE) continue

  const identicalEntries = []

  for (const namespace of USER_FACING_NAMESPACES) {
    for (const [keyPath, englishValue] of flattenEntries(refData[namespace], namespace)) {
      if (typeof englishValue !== 'string') continue
      if (!shouldWarnOnEnglishIdentical(englishValue)) continue

      const localeValue = getValueAtPath(data, keyPath)
      if (localeValue === englishValue) {
        identicalEntries.push([keyPath, englishValue])
      }
    }
  }

  if (identicalEntries.length > 0) {
    console.warn(
      `WARNING: ${file} has ${identicalEntries.length} English-identical value(s) in ${USER_FACING_NAMESPACES.join(', ')}:`,
    )
    for (const [keyPath, englishValue] of identicalEntries) {
      console.warn(`  - ${keyPath}: "${formatPreview(englishValue)}"`)
    }
    console.warn()
    warnings += identicalEntries.length
  }
}

// ---------------------------------------------------------------------------
// 5. Hardcoded strings in Vue templates (warnings — does not block CI)
// ---------------------------------------------------------------------------

let hardcodedVueCount = 0

for (const file of findFiles(SRC_DIR, (_fullPath, name) => name.endsWith('.vue'))) {
  const content = readFileSync(file, 'utf-8')
  const template = extractTemplate(content)
  if (!template) continue

  const lines = template.split('\n')
  const relPath = toRelPath(file)
  const templateStart =
    content.substring(0, content.indexOf('<template>')).split('\n').length

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.trim().startsWith('<!--')) continue
    if (line.trim().startsWith('//')) continue

    let match
    HARDCODED_TEXT_RE.lastIndex = 0
    while ((match = HARDCODED_TEXT_RE.exec(line)) !== null) {
      const text = match[1].trim()

      if (!text || !/[a-zA-Z]{2,}/.test(text)) continue
      if (/^\s*\{\{.*\}\}\s*$/.test(text)) continue
      if (/\{\{/.test(text)) continue
      if (VUE_ALLOWED_HARDCODED.has(text)) continue
      if (/^[a-z][-a-z0-9]*$/.test(text)) continue
      if (/^[\p{Emoji}\s]+$/u.test(text)) continue

      const lineNum = templateStart + i
      console.warn(`WARNING: ${relPath}:${lineNum} hardcoded text: "${text}"`)
      hardcodedVueCount++
    }
  }
}

if (hardcodedVueCount > 0) {
  console.warn(`\n${hardcodedVueCount} hardcoded string(s) found in templates (non-blocking).`)
  warnings += hardcodedVueCount
}

// ---------------------------------------------------------------------------
// 6. Hardcoded strings in TypeScript source (warnings — does not block CI)
// ---------------------------------------------------------------------------

let hardcodedTsCount = 0

for (const file of findFiles(SRC_DIR, (_fullPath, name) => name.endsWith('.ts') || name.endsWith('.tsx'))) {
  if (!shouldCheckTypeScriptFile(file)) continue

  const content = readFileSync(file, 'utf-8')
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  function visit(node) {
    if (ts.isPropertyAssignment(node)) {
      const propertyName = getPropertyNameText(node.name)
      const propertyPath = getPropertyPath(node)
      const text = getStaticString(node.initializer)

      if (
        propertyName &&
        TS_USER_FACING_PROPERTY_NAMES.has(propertyName) &&
        text &&
        !shouldSkipTypeScriptWarning(file, { propertyPath }) &&
        looksLikeHardcodedTypeScriptText(text, { propertyName, propertyPath })
      ) {
        const line = getLineNumber(sourceFile, node.initializer)
        console.warn(
          `WARNING: ${toRelPath(file)}:${line} hardcoded TypeScript string in \`${propertyPath}\`: "${formatPreview(text)}"`,
        )
        hardcodedTsCount++
      }
    }

    if (ts.isReturnStatement(node) && node.expression) {
      const functionName = getEnclosingFunctionName(node)
      const text = getStaticString(node.expression)

      if (
        functionName &&
        TS_USER_FACING_FUNCTION_RE.test(functionName) &&
        text &&
        !shouldSkipTypeScriptWarning(file, { functionName }) &&
        looksLikeHardcodedTypeScriptText(text)
      ) {
        const line = getLineNumber(sourceFile, node.expression)
        console.warn(
          `WARNING: ${toRelPath(file)}:${line} hardcoded TypeScript string returned from \`${functionName}()\`: "${formatPreview(text)}"`,
        )
        hardcodedTsCount++
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

if (hardcodedTsCount > 0) {
  console.warn(
    `\n${hardcodedTsCount} hardcoded user-facing string(s) found in TypeScript source (non-blocking).`,
  )
  warnings += hardcodedTsCount
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
  console.log(
    `All ${localeFiles.length} locale files OK — no errors, no missing keys, no English-identical values, and no hardcoded strings.`,
  )
} else if (errors === 0) {
  console.log(`${localeFiles.length} locale files passed escaping checks.`)
}

process.exit(errors > 0 ? 1 : 0)
