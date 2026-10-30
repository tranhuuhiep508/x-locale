import { describe, expect, it } from 'vitest'
import type { QaIssue } from '@/lib/api/types'
import { presentQaIssues, shouldFoldCleanLocales, shouldShowQaIndex } from './qa-issues'

function issue(
  code: string,
  token: string,
  sourceCount: number,
  translationCount: number,
): QaIssue {
  const missing = translationCount < sourceCount
  return {
    code,
    severity: 'error',
    message: `${missing ? 'Missing' : 'Extra'} placeholder ${token} (source has ${sourceCount}, translation has ${translationCount}).`,
    start: null,
    end: null,
    detail: { token, source_count: sourceCount, translation_count: translationCount },
  }
}

const length: QaIssue = {
  code: 'length',
  severity: 'warning',
  message: 'Translation is longer than the source.',
  start: null,
  end: null,
  detail: { length: 80, limit: 40 },
}

describe('presentQaIssues', () => {
  it('groups a typed placeholder that only changed format into one item', () => {
    const presented = presentQaIssues([
      issue('placeholder_missing', '{price, number}', 1, 0),
      issue('placeholder_extra', '{price, number, percent}', 0, 1),
      length,
    ])
    expect(presented.map((item) => item.code)).toEqual(['placeholder changed', 'length'])
    expect(presented[0].message).toBe(
      'Placeholder price changed from {price, number} to {price, number, percent}.',
    )
    expect(presented[0].severity).toBe('error')
  })

  it('groups a plain placeholder that gained an ICU type', () => {
    const presented = presentQaIssues([
      issue('placeholder_extra', '{count, number}', 0, 2),
      issue('placeholder_missing', '{count}', 2, 0),
    ])
    expect(presented).toHaveLength(1)
    expect(presented[0].message).toBe('Placeholder count changed from {count} to {count, number}.')
  })

  it('leaves a real missing placeholder and an unrelated extra alone', () => {
    const presented = presentQaIssues([
      issue('placeholder_missing', '{name}', 1, 0),
      issue('placeholder_extra', '{other}', 0, 1),
    ])
    expect(presented.map((item) => item.code)).toEqual(['placeholder_missing', 'placeholder_extra'])
  })

  it('does not group when the counts are not a one-for-one swap', () => {
    const presented = presentQaIssues([
      issue('placeholder_missing', '{price, number}', 2, 0),
      issue('placeholder_extra', '{price, number, percent}', 0, 1),
    ])
    expect(presented.map((item) => item.code)).toEqual(['placeholder_missing', 'placeholder_extra'])
  })

  it('does not guess when the same name has more than one replacement', () => {
    const presented = presentQaIssues([
      issue('placeholder_missing', '{price, number}', 1, 0),
      issue('placeholder_extra', '{price, number, percent}', 0, 1),
      issue('placeholder_extra', '{price, date}', 0, 1),
    ])
    expect(presented.map((item) => item.code)).toEqual([
      'placeholder_missing',
      'placeholder_extra',
      'placeholder_extra',
    ])
  })

  it('does not treat printf tokens as an ICU style change', () => {
    const presented = presentQaIssues([
      issue('placeholder_missing', '%s', 1, 0),
      issue('placeholder_extra', '%1$s', 0, 1),
    ])
    expect(presented.map((item) => item.code)).toEqual(['placeholder_missing', 'placeholder_extra'])
  })
})

describe('QA scan layout', () => {
  it('indexes and folds only a long filtered page', () => {
    expect(shouldShowQaIndex(8, 'issues')).toBe(false)
    expect(shouldShowQaIndex(9, 'all')).toBe(false)
    expect(shouldShowQaIndex(9, 'issues')).toBe(true)
    expect(shouldFoldCleanLocales(8)).toBe(false)
    expect(shouldFoldCleanLocales(9)).toBe(true)
  })
})
