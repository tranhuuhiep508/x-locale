import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StringsSearch } from '@/lib/schemas'
import { StringsFilters } from './StringsFilters'

afterEach(cleanup)

function renderFilters(search: StringsSearch) {
  const onFilter = vi.fn()
  const onSearchInputChange = vi.fn()
  const onClear = vi.fn()
  render(
    <StringsFilters
      search={search}
      searchInput={search.q ?? ''}
      modules={[]}
      tags={[]}
      locales={['en', 'fr']}
      onFilter={onFilter}
      onSearchInputChange={onSearchInputChange}
      onClear={onClear}
    />
  )
  return { onFilter, onSearchInputChange, onClear }
}

describe('active string filter chips', () => {
  it('removes one filter group while keeping the other criteria', () => {
    const { onFilter, onClear } = renderFilters({
      q: 'account',
      pending_delete: true,
      unassigned_module: true,
      complete_locale: 'en',
    })
    const chips = within(screen.getByRole('list', { name: 'Active filters' }))
    expect(chips.getAllByRole('button')).toHaveLength(4)
    fireEvent.click(chips.getByRole('button', { name: 'Remove status filter' }))
    expect(onFilter).toHaveBeenCalledWith({
      status: undefined,
      has_unpublished_changes: undefined,
      pending_delete: undefined,
      never_published: undefined,
      deleted: undefined,
    })
    expect(onClear).not.toHaveBeenCalled()
    fireEvent.click(chips.getByRole('button', { name: 'Remove module filter' }))
    expect(onFilter).toHaveBeenLastCalledWith({ module: undefined, unassigned_module: undefined })
  })

  it('clears the input and URL search together when removing the search chip', () => {
    const { onFilter, onSearchInputChange } = renderFilters({ q: 'account', missing_any: true })
    fireEvent.click(screen.getByRole('button', { name: 'Remove search filter' }))
    expect(onSearchInputChange).toHaveBeenCalledWith('')
    expect(onFilter).toHaveBeenCalledWith({ q: undefined })
  })

  it('clears every time parameter together without resetting other filters', () => {
    const { onFilter } = renderFilters({
      since: '2026-01-01',
      until: '2026-01-02',
      status: 'draft',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove time filter' }))
    expect(onFilter).toHaveBeenCalledWith({
      period: undefined,
      since: undefined,
      until: undefined,
      updated_within_days: undefined,
    })
  })

  it('removes a batch filter and its label together', () => {
    const { onFilter } = renderFilters({ batch_id: 'batch-id', batch_kind: 'import', q: 'account' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear batch filter' }))
    expect(onFilter).toHaveBeenCalledWith({ batch_id: undefined, batch_kind: undefined })
  })

  it('shows a bookmarked confidence threshold accurately and allows removing it', () => {
    const { onFilter } = renderFilters({ max_confidence: 74, missing_any: true })
    expect(screen.getByRole('combobox', { name: 'AI' }).textContent).toContain('≤ 74')
    fireEvent.click(screen.getByRole('button', { name: 'Remove confidence filter' }))
    expect(onFilter).toHaveBeenCalledWith({ max_confidence: undefined })
  })
})
