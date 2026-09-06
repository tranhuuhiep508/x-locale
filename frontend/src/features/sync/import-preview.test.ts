import { describe, expect, it } from 'vitest'
import {
  IMPORT_KEY_LIST_LIMIT,
  hasMatchingImportKeys,
  importKeyListFooter,
  visibleImportKeys,
} from './import-preview'

const keys = ['common.save', 'auth.sign_in', 'hello', 'home.title']

describe('visibleImportKeys', () => {
  it('returns every key when the query is empty and under the cap', () => {
    const result = visibleImportKeys(keys, '')
    expect(result.items).toEqual(keys)
    expect(result.matchCount).toBe(4)
    expect(result.total).toBe(4)
  })

  it('filters with a case-insensitive substring', () => {
    const result = visibleImportKeys(keys, 'AUTH')
    expect(result.items).toEqual(['auth.sign_in'])
    expect(result.matchCount).toBe(1)
    expect(result.total).toBe(4)
  })

  it('trims the query before matching', () => {
    expect(visibleImportKeys(keys, '  hello  ').items).toEqual(['hello'])
  })

  it('caps the rendered list without changing matchCount', () => {
    const many = Array.from({ length: 150 }, (_, i) => `key.${i}`)
    const result = visibleImportKeys(many, '', 100)
    expect(result.items).toHaveLength(100)
    expect(result.items[0]).toBe('key.0')
    expect(result.items[99]).toBe('key.99')
    expect(result.matchCount).toBe(150)
    expect(result.total).toBe(150)
  })

  it('filters first, then caps', () => {
    const many = Array.from({ length: 150 }, (_, i) => (i % 2 === 0 ? `keep.${i}` : `skip.${i}`))
    const result = visibleImportKeys(many, 'keep', 100)
    expect(result.items).toHaveLength(75)
    expect(result.matchCount).toBe(75)
    expect(result.total).toBe(150)
    expect(result.items.every((key) => key.startsWith('keep.'))).toBe(true)
  })
})

describe('importKeyListFooter', () => {
  it('is omitted when unfiltered and under the cap', () => {
    expect(
      importKeyListFooter({ query: '', matchCount: 4, total: 4, label: 'updated' }),
    ).toBeNull()
  })

  it('shows the cap remainder when unfiltered and over the limit', () => {
    expect(
      importKeyListFooter({
        query: '',
        matchCount: 12430,
        total: 12430,
        label: 'updated',
      }),
    ).toBe(`Showing ${IMPORT_KEY_LIST_LIMIT} of 12430 updated`)
  })

  it('reports match count when filtered under the cap', () => {
    expect(
      importKeyListFooter({ query: 'save', matchCount: 12, total: 80, label: 'updated' }),
    ).toBe('12 matches')
  })

  it('reports a capped match count when filtered over the limit', () => {
    expect(
      importKeyListFooter({
        query: 'common',
        matchCount: 340,
        total: 12430,
        label: 'updated',
      }),
    ).toBe(`Showing ${IMPORT_KEY_LIST_LIMIT} of 340 matches`)
  })

  it('reports no matches for a filtered miss', () => {
    expect(
      importKeyListFooter({ query: ' foo ', matchCount: 0, total: 80, label: 'updated' }),
    ).toBe('No keys match “foo”')
  })
})

describe('hasMatchingImportKeys', () => {
  it('is true when any section still has matches', () => {
    expect(hasMatchingImportKeys([keys, [], []], 'hello')).toBe(true)
    expect(hasMatchingImportKeys([keys, [], []], 'missing')).toBe(false)
  })
})
