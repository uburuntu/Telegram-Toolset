/**
 * Message-format analysis backed by the real vue-i18n message compiler
 * (`@intlify/message-compiler`, the same parser vue-i18n uses at runtime).
 *
 * Using the actual compiler instead of hand-rolled regexes means the checker
 * flags exactly the syntax that silently crashes a component at runtime —
 * unescaped `@`, nested `{{ }}`, empty/unbalanced braces, malformed linked
 * messages — and extracts the true set of interpolation placeholders, including
 * spaced (`{ name }`) and list (`{0}`) forms the previous regex missed.
 */

import { CompileErrorCodes, createParser } from '@intlify/message-compiler'

const COMPILE_ERROR_CODE_NAMES = Object.fromEntries(
  Object.entries(CompileErrorCodes).map(([name, code]) => [code, name]),
)

// NodeTypes from @intlify/message-compiler (numeric enum, not re-exported).
const NODE_TYPE_NAMED = 4
const NODE_TYPE_LIST = 5

export function describeCompileError(error) {
  const codeName = COMPILE_ERROR_CODE_NAMES[error?.code] ?? 'INVALID_MESSAGE_SYNTAX'
  const start = error?.location?.start
  const position = start ? ` (line ${start.line}, column ${start.column})` : ''
  const message = error?.message ?? String(error)
  return `${codeName}: ${message}${position}`
}

/**
 * Parse a single message and return any compile errors plus the deduped,
 * sorted set of interpolation placeholders (named as `{key}`, list as `{index}`).
 */
export function analyzeMessageFormat(value) {
  if (typeof value !== 'string') {
    return { errors: [], placeholders: [] }
  }

  const errors = []
  const parser = createParser({
    location: true,
    onError: (error) => errors.push(error),
  })

  let ast
  try {
    ast = parser.parse(value)
  } catch (error) {
    // The parser normally routes problems through onError, but guard against
    // inputs that throw so one bad string cannot crash the whole checker.
    errors.push(error)
  }

  const placeholders = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') {
      return
    }

    if (node.type === NODE_TYPE_NAMED) {
      placeholders.add(`{${node.key}}`)
    } else if (node.type === NODE_TYPE_LIST) {
      placeholders.add(`{${node.index}}`)
    }

    walk(node.body)
    walk(node.key)
    walk(node.modifier)
    if (Array.isArray(node.items)) {
      node.items.forEach(walk)
    }
    if (Array.isArray(node.cases)) {
      node.cases.forEach(walk)
    }
  }
  walk(ast)

  return {
    errors,
    placeholders: [...placeholders].sort(),
  }
}
