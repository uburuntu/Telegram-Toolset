import { describe, expect, it } from 'vitest'
// @ts-expect-error - plain ESM checker helper shared with scripts/check-i18n.js
import { analyzeMessageFormat, describeCompileError } from '../../scripts/i18n-message-format.mjs'

describe('analyzeMessageFormat', () => {
  it('accepts valid named, spaced, and list placeholders', () => {
    expect(analyzeMessageFormat('Hello {name}')).toEqual({
      errors: [],
      placeholders: ['{name}'],
    })

    // The previous regex-based checker missed spaced placeholders entirely.
    expect(analyzeMessageFormat('Hello { name }')).toEqual({
      errors: [],
      placeholders: ['{name}'],
    })

    expect(analyzeMessageFormat('Item {0}')).toEqual({
      errors: [],
      placeholders: ['{0}'],
    })
  })

  it('treats an escaped @ literal as valid with no placeholders', () => {
    const result = analyzeMessageFormat("Include {'@'}username")
    expect(result.errors).toEqual([])
    expect(result.placeholders).toEqual([])
  })

  it('dedupes placeholders across plural cases', () => {
    const result = analyzeMessageFormat('{count} item | {count} items')
    expect(result.errors).toEqual([])
    expect(result.placeholders).toEqual(['{count}'])
  })

  it('sorts a mix of named and list placeholders', () => {
    expect(analyzeMessageFormat('literal {0} and {name}').placeholders).toEqual(['{0}', '{name}'])
  })

  it('flags syntax that silently crashes vue-i18n at runtime', () => {
    for (const invalid of ['Include @username', 'Price {{total}}', 'Unbalanced {name', 'Empty {}']) {
      expect(analyzeMessageFormat(invalid).errors.length).toBeGreaterThan(0)
    }
  })

  it('ignores non-string values', () => {
    expect(analyzeMessageFormat(undefined as unknown as string)).toEqual({
      errors: [],
      placeholders: [],
    })
  })

  it('describes a compile error with a readable code name', () => {
    const [error] = analyzeMessageFormat('Include @username').errors
    expect(describeCompileError(error)).toMatch(/[A-Z_]+/)
  })
})
