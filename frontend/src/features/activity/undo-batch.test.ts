import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/client'
import { isUndoConflict, undoDescription, undoOverwriteDescription } from '@/features/activity/undo-batch'
import type { ActivityFeedCard } from '@/lib/api/types'

function card(overrides: Partial<ActivityFeedCard>): ActivityFeedCard {
  return {
    id: '1',
    kind: 'batch',
    event_type: 'import',
    summary: 'Imported',
    actor_type: 'user',
    actor_label: 'dev',
    created_at: null,
    string_id: null,
    string_key: null,
    locale: null,
    batch_id: 'b1',
    batch_kind: 'import',
    children_count: 3,
    is_undoable: true,
    counts: {},
    changed: [],
    children: [],
    ...overrides,
  }
}

describe('undoDescription', () => {
  it('warns about tombstones when the batch created strings', () => {
    expect(undoDescription(card({ counts: { created: 2 } }))).toContain('moved to Deleted')
    expect(undoDescription(card({ counts: { created: 2 } }))).not.toContain('overwritten')
  })

  it('uses singular nouns for a one-string create undo', () => {
    expect(undoDescription(card({ children_count: 1, counts: { created: 1 } }))).toBe(
      'This undoes 1 string. 1 new string will be moved to Deleted ' +
        '(or queued for public removal if already published).',
    )
  })

  it('describes a restore when nothing was created', () => {
    expect(undoDescription(card({ counts: { updated: 3 } }))).toContain('values before this action')
    expect(undoDescription(card({ counts: { updated: 3 } }))).not.toContain('overwritten')
  })
})

describe('isUndoConflict', () => {
  it('detects 409 from the revert API', () => {
    expect(isUndoConflict(new ApiError(409, 'Conflict'))).toBe(true)
    expect(isUndoConflict(new ApiError(400, 'Bad'))).toBe(false)
    expect(isUndoConflict(new Error('nope'))).toBe(false)
  })
})

describe('undoOverwriteDescription', () => {
  it('states that later edits will be overwritten', () => {
    expect(undoOverwriteDescription()).toContain('overwritten')
  })
})
