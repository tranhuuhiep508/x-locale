import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api/client'
import {
  isUndoConflict,
  outcomeLabel,
  undoDescription,
  undoOverwriteDescription,
} from '@/features/activity/undo-batch'
import type { ActivityFeedCard, RevertPreview, RevertPreviewItem } from '@/lib/api/types'

function previewItem(overrides: Partial<RevertPreviewItem>): RevertPreviewItem {
  return {
    activity_id: 'a1',
    string_id: 's1',
    string_key: 'welcome',
    outcome: 'restore_values',
    conflict: false,
    affects_published: false,
    changes: [],
    ...overrides,
  }
}

function preview(overrides: Partial<RevertPreview>): RevertPreview {
  return {
    items: [],
    total: 0,
    conflict_count: 0,
    requires_force: false,
    affects_published: false,
    ...overrides,
  }
}

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

  it('names the conflict count when a preview is available', () => {
    const text = undoOverwriteDescription(preview({ conflict_count: 2 }))
    expect(text).toContain('2 strings')
    expect(text).toContain('overwritten')
  })
})

describe('undoDescription with preview', () => {
  it('reflects the preview total and creation count instead of the card estimate', () => {
    const text = undoDescription(
      card({ counts: { created: 99 } }),
      preview({
        total: 2,
        items: [
          previewItem({ outcome: 'move_to_deleted' }),
          previewItem({ outcome: 'restore_values' }),
        ],
      }),
    )
    expect(text).toContain('This undoes 2 strings')
    expect(text).toContain('1 new string')
  })

  it('mentions the published snapshot when the preview flags it', () => {
    const text = undoDescription(
      card({ counts: { updated: 1 } }),
      preview({ total: 1, affects_published: true }),
    )
    expect(text).toContain('published snapshot')
  })
})

describe('outcomeLabel', () => {
  it('labels each outcome', () => {
    expect(outcomeLabel(previewItem({ outcome: 'restore_values' }))).toBe('Restore previous value')
    expect(outcomeLabel(previewItem({ outcome: 'move_to_deleted' }))).toBe('Move to Deleted')
    expect(outcomeLabel(previewItem({ outcome: 'recreate' }))).toBe('Recreate')
    expect(outcomeLabel(previewItem({ outcome: 'already_reverted' }))).toBe('Already undone')
    expect(outcomeLabel(previewItem({ outcome: 'missing' }))).toBe('No longer exists')
  })
})
