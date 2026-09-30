import { describe, expect, it } from 'vitest'
import { reviewBatchTarget } from '@/features/activity/review-batch'
import type { ActivityFeedCard } from '@/lib/api/types'

function card(overrides: Partial<ActivityFeedCard> = {}): ActivityFeedCard {
  return {
    id: 'card-1',
    kind: 'batch',
    event_type: 'import',
    summary: 'Imported 2 strings',
    actor_type: 'user',
    actor_label: 'Dev',
    created_at: '2026-09-30T00:00:00Z',
    string_id: null,
    string_key: null,
    locale: null,
    batch_id: '11111111-1111-4111-8111-111111111111',
    batch_kind: 'import',
    children_count: 2,
    is_undoable: true,
    counts: { created: 2 },
    changed: [],
    changed_count: 0,
    children: [],
    ...overrides,
  }
}

describe('reviewBatchTarget', () => {
  it('links import, excel, and translate batches', () => {
    expect(reviewBatchTarget(card())).toEqual({
      batchId: '11111111-1111-4111-8111-111111111111',
      batchKind: 'import',
    })
    expect(reviewBatchTarget(card({ batch_kind: 'excel_import' }))?.batchKind).toBe(
      'excel_import',
    )
    expect(reviewBatchTarget(card({ batch_kind: 'translate' }))?.batchKind).toBe('translate')
  })

  it('skips revert, publish batches, empty cards, and singles', () => {
    expect(reviewBatchTarget(card({ batch_kind: 'revert' }))).toBeNull()
    expect(reviewBatchTarget(card({ batch_kind: 'batch' }))).toBeNull()
    expect(reviewBatchTarget(card({ batch_id: null }))).toBeNull()
    expect(reviewBatchTarget(card({ children_count: 0 }))).toBeNull()
    expect(
      reviewBatchTarget(
        card({
          kind: 'single',
          batch_id: null,
          batch_kind: null,
          children_count: 0,
          string_id: 'string-1',
        }),
      ),
    ).toBeNull()
  })
})
