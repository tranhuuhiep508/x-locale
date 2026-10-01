import { describe, expect, it } from 'vitest'
import { batchSuccessMessage, unpublishConfirmCopy } from './batch-feedback'

describe('batchSuccessMessage', () => {
  it('includes counts for publish, unpublish, discard, and restore', () => {
    expect(batchSuccessMessage('publish', 1)).toBe('Published 1 string')
    expect(batchSuccessMessage('publish', 3)).toBe('Published 3 strings')
    expect(batchSuccessMessage('unpublish', 1)).toBe('Unpublished 1 string')
    expect(batchSuccessMessage('unpublish', 4)).toBe('Unpublished 4 strings')
    expect(batchSuccessMessage('discard_changes', 2)).toBe('Discarded changes on 2 strings')
    expect(batchSuccessMessage('discard_delete', 1)).toBe('Discarded pending delete on 1 string')
    expect(batchSuccessMessage('restore', 2)).toBe('Restored 2 strings')
    expect(batchSuccessMessage('restore_last_history', 1)).toBe('Restored last edit on 1 string')
  })

  it('skips toasts for catalog actions that already have their own dialogs', () => {
    expect(batchSuccessMessage('move_module', 1)).toBeNull()
    expect(batchSuccessMessage('add_tags', 2)).toBeNull()
    expect(batchSuccessMessage('delete', 1)).toBeNull()
  })
})

describe('unpublishConfirmCopy', () => {
  it('uses singular copy for one string', () => {
    const copy = unpublishConfirmCopy(1)
    expect(copy.title).toBe('Unpublish this string?')
    expect(copy.confirmLabel).toBe('Unpublish')
    expect(copy.description).toMatch(/Cancel leaves the catalog unchanged/)
  })

  it('uses a count in the title for multiple strings', () => {
    expect(unpublishConfirmCopy(3).title).toBe('Unpublish 3 strings?')
  })
})

describe('mixed-selection feedback', () => {
  it('reports affected rows and skips, including server-side no-ops', () => {
    expect(batchSuccessMessage('discard_delete', 1, 3)).toBe(
      'Discarded pending delete on 1 string. 2 selected strings skipped because they do not qualify.',
    )
    expect(batchSuccessMessage('restore_last_history', 0, 1)).toBe(
      'Restored last edit on 0 strings. 1 selected string skipped because it does not qualify.',
    )
    expect(batchSuccessMessage('delete', 1, 2)).toBe(
      'Marked 1 string for deletion. 1 selected string skipped because it does not qualify.',
    )
  })

  it('does not mistake tag assignment counts for affected string counts', () => {
    expect(batchSuccessMessage('add_tags', 4, 2)).toBeNull()
  })

  it('describes eligible unpublishes and skipped rows before confirmation', () => {
    const copy = unpublishConfirmCopy(1, 3)
    expect(copy.title).toBe('Unpublish this string?')
    expect(copy.description).toContain('2 selected strings will be skipped')
  })
})
