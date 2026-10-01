import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BatchActionBar } from './BatchActionBar'
import { batchActionSelection } from './batch-selection'
import type { StringEntry } from '@/lib/api/types'

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

function props() {
  return {
    selectedCount: 3, visible: true, modules: [], tags: [],
    actions: batchActionSelection([
      entry('live'),
      entry('pending', { pending_delete: true, has_unpublished_changes: true }),
      entry('deleted', { deleted_at: '2026-02-01T00:00:00Z' }),
    ]),
    onPublish: vi.fn(), onUnpublish: vi.fn(), onMove: vi.fn(), onAddTags: vi.fn(),
    onDelete: vi.fn(), onDiscardChanges: vi.fn(), onDiscardDelete: vi.fn(),
    onRestore: vi.fn(), onRestoreLastEdit: vi.fn(), onClear: vi.fn(),
  }
}

describe('BatchActionBar', () => {
  it('shows eligible counts with distinct descriptions for pending removals and deleted rows', () => {
    const callbacks = props()
    render(<BatchActionBar {...callbacks} />)
    const discard = screen.getByRole('button', { name: 'Discard delete', exact: true })
    expect(discard.textContent).toContain('1')
    expect(discard.getAttribute('aria-description')).toContain('1 of 3')
    expect(discard.getAttribute('aria-description')).toContain('Deleted strings stay deleted')
    fireEvent.click(discard)
    expect(callbacks.onDiscardDelete).toHaveBeenCalledOnce()
    const restore = screen.getByRole('button', { name: 'Restore', exact: true })
    expect(restore.textContent).toContain('1')
    expect(restore.getAttribute('aria-description')).toContain('Pending removals stay queued')
    const history = screen.getByRole('button', { name: 'Restore last edit', exact: true })
    expect(history.textContent).toContain('≤ 2')
    expect(history.getAttribute('aria-description')).toContain('Up to 2 of 3')
  })

  it('disables actions with no eligible strings', () => {
    const callbacks = props()
    render(<BatchActionBar {...callbacks} actions={batchActionSelection([
      entry('deleted', { deleted_at: '2026-02-01T00:00:00Z' }),
    ])} selectedCount={1} />)
    for (const name of ['Publish', 'Unpublish', 'Delete']) {
      const button = screen.getByRole('button', { name, exact: true })
      expect((button as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(button)
    }
    expect(callbacks.onPublish).not.toHaveBeenCalled()
    expect(callbacks.onUnpublish).not.toHaveBeenCalled()
    expect(callbacks.onDelete).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Restore', exact: true }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('blocks actions while checking but lets users clear their selection', () => {
    const callbacks = props()
    render(<BatchActionBar {...callbacks} checking />)
    expect((screen.getByRole('button', { name: 'Discard delete' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('Checking selected strings across pages')
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(callbacks.onClear).toHaveBeenCalledOnce()
  })

  it('offers retry when selection lookup fails', () => {
    const retry = vi.fn()
    render(<BatchActionBar {...props()} selectionError onRetry={retry} />)
    expect((screen.getByRole('button', { name: 'Publish', exact: true }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('status').textContent).toContain('Retry to enable actions')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
