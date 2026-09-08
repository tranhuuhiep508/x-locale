import { describe, expect, it } from 'vitest'
import type { TranslateProposalItem } from '@/lib/api/types'
import {
  applyPayloadFromDrafts,
  clampPage,
  descriptionsFromDrafts,
  draftsFromItems,
  filledCount,
  updateDraftDescription,
  updateDraftTranslation,
} from './translate-review'

function item(
  overrides: Partial<TranslateProposalItem> & Pick<TranslateProposalItem, 'string_id'>,
): TranslateProposalItem {
  return {
    key: 'greet',
    source_text: 'Xin chào',
    status: 'draft',
    description: '',
    translations: { en: '', ja: '' },
    scores: {},
    ...overrides,
  }
}

describe('draftsFromItems', () => {
  it('keys drafts by string_id without sharing nested objects', () => {
    const source = item({ string_id: 'a', translations: { en: 'Hi' }, scores: { en: 90 } })
    const drafts = draftsFromItems([source])
    drafts.a.translations.en = 'Hello'
    drafts.a.scores!.en = 10
    expect(source.translations.en).toBe('Hi')
    expect(source.scores?.en).toBe(90)
  })
})

describe('updateDraftTranslation', () => {
  it('updates one row and drops that locale score', () => {
    const drafts = draftsFromItems([
      item({ string_id: 'a', translations: { en: 'Hi', ja: '' }, scores: { en: 90, ja: 40 } }),
      item({ string_id: 'b', translations: { en: 'Bye' }, scores: { en: 80 } }),
    ])
    const next = updateDraftTranslation(drafts, 'a', 'en', 'Hello')
    expect(next.a.translations.en).toBe('Hello')
    expect(next.a.scores).toEqual({ ja: 40 })
    expect(next.b).toBe(drafts.b)
  })
})

describe('updateDraftDescription', () => {
  it('updates one description', () => {
    const drafts = draftsFromItems([item({ string_id: 'a' }), item({ string_id: 'b' })])
    const next = updateDraftDescription(drafts, 'a', 'login button')
    expect(next.a.description).toBe('login button')
    expect(next.b).toBe(drafts.b)
  })
})

describe('applyPayloadFromDrafts', () => {
  it('drops empty locales and keeps descriptions', () => {
    const payload = applyPayloadFromDrafts([
      item({
        string_id: 'a',
        description: 'ctx',
        translations: { en: 'Hello', ja: '  ' },
        scores: { en: 91 },
      }),
    ])
    expect(payload).toEqual([
      {
        string_id: 'a',
        translations: { en: 'Hello' },
        scores: { en: 91 },
        description: 'ctx',
      },
    ])
  })
})

describe('descriptionsFromDrafts', () => {
  it('includes empty descriptions so Translate can override stored context', () => {
    expect(
      descriptionsFromDrafts([
        item({ string_id: 'a', description: 'keep' }),
        item({ string_id: 'b', description: '' }),
      ]),
    ).toEqual({ a: 'keep', b: '' })
  })
})

describe('filledCount', () => {
  it('counts non-empty translation cells', () => {
    expect(
      filledCount([
        item({ string_id: 'a', translations: { en: 'Hi', ja: '' } }),
        item({ string_id: 'b', translations: { en: '  ' } }),
      ]),
    ).toBe(1)
  })
})

describe('clampPage', () => {
  it('stays on the last non-empty page after apply shrinks the catalog', () => {
    expect(clampPage(3, 40, 50)).toBe(1)
    expect(clampPage(2, 80, 50)).toBe(2)
    expect(clampPage(0, 80, 50)).toBe(1)
    expect(clampPage(1, 0, 50)).toBe(1)
  })
})
