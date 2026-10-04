import { describe, expect, it } from 'vitest'
import { parseRestorePreview, parseRevertPreview, PreviewContractError } from './preview-contract'

const undo = {
  can_revert: false,
  requires_force: false,
  affects_published: false,
  items: [],
  conflicts: [],
  total: 0,
  conflict_count: 0,
  outcome_counts: {
    restore_values: 0,
    move_to_deleted: 0,
    recreate: 0,
    already_reverted: 0,
    missing: 0,
  },
}
const restore = {
  string_id: 'string',
  activity_id: 'activity',
  can_restore: false,
  already_matches: false,
  pending_delete: false,
  changes: [],
}

describe('preview response contracts', () => {
  it('accepts false safety flags, optional metadata, and extra fields', () => {
    expect(parseRevertPreview({ ...undo, extra: 'future' }).can_revert).toBe(false)
    expect(parseRestorePreview({ ...restore, extra: 'future' }).can_restore).toBe(false)
  })

  it.each(['can_revert', 'requires_force', 'affects_published'])('requires boolean %s', (field) => {
    for (const value of [undefined, null, 'false', 0]) {
      expect(() => parseRevertPreview({ ...undo, [field]: value })).toThrow(PreviewContractError)
    }
  })

  it('requires a boolean restore capability', () => {
    for (const value of [undefined, null, 'true', 1]) {
      expect(() => parseRestorePreview({ ...restore, can_restore: value })).toThrow(
        PreviewContractError
      )
    }
  })

  it('rejects malformed collections and changes with a readable retry message', () => {
    expect(() => parseRevertPreview({ ...undo, items: null })).toThrow('incompatible preview')
    expect(() => parseRestorePreview({ ...restore, changes: [{ field: 'translation' }] })).toThrow(
      'Retry after the server update'
    )
    const result = parseRestorePreview({
      ...restore,
      changes: [
        {
          field: 'translation',
          locale: 'fr',
          scope: 'draft',
          kind: 'translation',
          before: 'Bonjour',
          after: null,
        },
      ],
    })
    expect(result.changes[0].after).toBeNull()
  })
})
