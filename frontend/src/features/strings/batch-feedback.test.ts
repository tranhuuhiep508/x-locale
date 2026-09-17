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
