import { describe, expect, it } from 'vitest'
import type { StringEntry } from '@/lib/api/types'
import { batchActionSelection, batchSkippedMessage } from './batch-selection'

function entry(id: string, overrides: Partial<StringEntry> = {}): StringEntry {
  return {
    id, key: id, source_text: 'Source', description: null,
    status: 'public', pending_delete: false, deleted_at: null,
    has_unpublished_changes: false, published_at: '2026-01-01T00:00:00Z',
    published_key: id, published_source_text: 'Source',
    published_module_id: null, published_module_slug: null,
    module_id: null, module_slug: null, tags: [], translations: [],
    created_at: null, created_by_type: null, created_by_label: null,
    updated_at: null, updated_by_type: null, updated_by_label: null,
    ...overrides,
  }
}

describe('batchActionSelection', () => {
  it('keeps pending removals and tombstones separate in a mixed selection', () => {
    const actions = batchActionSelection([
      entry('live'),
      entry('draft', { status: 'draft', published_key: null, published_at: null }),
      entry('edited', { source_text: 'Changed', has_unpublished_changes: true }),
      entry('pending', { pending_delete: true, has_unpublished_changes: true }),
      entry('deleted', { deleted_at: '2026-02-01T00:00:00Z' }),
      entry('deleted-draft', { status: 'draft', published_key: null,
        published_at: null, deleted_at: '2026-02-01T00:00:00Z' }),
    ])
    expect(actions.discard_delete).toEqual(['pending'])
    expect(actions.restore).toEqual(['deleted', 'deleted-draft'])
    expect(actions.publish).toEqual(['draft', 'edited', 'pending'])
    expect(actions.unpublish).toEqual(['live', 'edited', 'pending'])
    expect(actions.delete).toEqual(['live', 'draft', 'edited'])
    expect(actions.discard_changes).toEqual(['edited', 'pending'])
    expect(actions.restore_last_history).toEqual(['live', 'draft', 'edited', 'pending'])
    expect(actions.move_module).toHaveLength(6)
    expect(actions.add_tags).toHaveLength(6)
  })

  it('offers no live lifecycle actions for deleted strings, even with pending flags', () => {
    const actions = batchActionSelection([
      entry('deleted', { deleted_at: '2026-02-01T00:00:00Z', pending_delete: true,
        has_unpublished_changes: true }),
    ])
    expect(actions.discard_delete).toEqual([])
    expect(actions.discard_changes).toEqual([])
    expect(actions.publish).toEqual([])
    expect(actions.unpublish).toEqual([])
    expect(actions.delete).toEqual([])
    expect(actions.restore_last_history).toEqual([])
    expect(actions.restore).toEqual(['deleted'])
  })

  it('counts an unpublished snapshot as publishable but cannot unpublish it again', () => {
    const actions = batchActionSelection([entry('draft', { status: 'draft' })])
    expect(actions.publish).toEqual(['draft'])
    expect(actions.unpublish).toEqual([])
    expect(actions.discard_changes).toEqual([])
  })
})

describe('batchSkippedMessage', () => {
  it('distinguishes preview copy from completed actions and handles singular counts', () => {
    expect(batchSkippedMessage(3, 1, true)).toBe('2 selected strings will be skipped because they do not qualify.')
    expect(batchSkippedMessage(2, 1)).toBe('1 selected string skipped because it does not qualify.')
    expect(batchSkippedMessage(2, 2)).toBe('')
    expect(batchSkippedMessage(2, 3)).toBe('')
  })
})
