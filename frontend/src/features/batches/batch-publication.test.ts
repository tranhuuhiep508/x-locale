import { expect, it } from 'vitest'
import { buildBatchPublishItems, type BatchDraft } from './batch-publication'

it('builds a whole large batch with its reviewed values and confidence', () => {
  const entries = Array.from({ length: 5000 }, (_, i) => ({ id: `string-${i}` }))
  const drafts: Record<string, BatchDraft> = Object.fromEntries(
    entries.flatMap(({ id }) => [
      [`${id}:en`, { value: `Reviewed ${id}`, source: `Source ${id}`, score: 90 }],
      [`${id}:ja`, { value: '', source: `Source ${id}`, score: null }],
    ])
  )
  drafts['outside:en'] = { value: 'Outside this batch', source: 'Outside', score: null }
  expect(buildBatchPublishItems(entries, drafts)).toEqual(
    entries.map(({ id }) => ({
      string_id: id,
      expected_source_text: `Source ${id}`,
      translations: { en: `Reviewed ${id}`, ja: '' },
      scores: { en: 90, ja: null },
    }))
  )
})
