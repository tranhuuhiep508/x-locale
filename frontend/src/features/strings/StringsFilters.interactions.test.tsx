import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StringsSearch } from '@/lib/schemas'
import { StringsFilters } from './StringsFilters'

afterEach(cleanup)

function renderFilters(
  search: StringsSearch,
  tags: ComponentProps<typeof StringsFilters>['tags'] = [],
) {
  const onFilter = vi.fn()
  const onSearchInputChange = vi.fn()
  const onClear = vi.fn()
  render(
    <StringsFilters
      search={search}
      searchInput={search.q ?? ''}
      modules={[]}
      tags={tags}
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

  it('renders all filters in a single compact row directly accessible without extra clicks', () => {
    renderFilters({})
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'Translation' })).toBeDefined()
    expect(screen.getByRole('combobox', { name: 'AI' })).toBeDefined()
    expect(screen.getByRole('textbox', { name: 'Search strings' })).toBeDefined()
  })

  it('displays active filter criteria directly in the compact triggers and active list', () => {
    renderFilters({ status: 'draft', max_confidence: 60 })
    expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toContain('Draft')
    expect(screen.getByRole('combobox', { name: 'AI' }).textContent).toContain('≤ 60')
    const chips = within(screen.getByRole('list', { name: 'Active filters' }))
    expect(chips.getByRole('button', { name: 'Remove status filter' })).toBeDefined()
    expect(chips.getByRole('button', { name: 'Remove confidence filter' })).toBeDefined()
  })

  it('exposes searchable tag choices as ordinary buttons', async () => {
    renderFilters({}, [{ id: 'tag-1', name: 'Core', color: '#65707b', string_count: 1 }])
    fireEvent.click(screen.getByRole('button', { name: /^Tag$/ }))
    const choices = within(await screen.findByRole('list', { name: 'Tag options' }))
    expect(choices.getByRole('button', { name: 'Core' })).toBeDefined()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('uses the first search match on Enter instead of the pinned selected tag', async () => {
    const tags = [
      { id: 'alpha', name: 'Alpha', color: '#65707b', string_count: 1 },
      { id: 'beta', name: 'Beta', color: '#65707b', string_count: 1 },
    ]
    const { onFilter } = renderFilters({ tag: 'alpha' }, tags)
    fireEvent.click(screen.getByRole('button', { name: /^Tag$/ }))
    const search = await screen.findByRole('textbox', { name: 'Search tags…' })
    fireEvent.change(search, { target: { value: 'Beta' } })
    const choices = within(screen.getByRole('list', { name: 'Tag options' }))
    expect(choices.getByRole('button', { name: 'Alpha' })).toBeDefined()
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onFilter).toHaveBeenCalledWith({ tag: 'beta', untagged: undefined })
  })

  it('counts only matching choices when the selected tag is pinned', async () => {
    const tags = [
      { id: 'other', name: 'Other', color: '#65707b', string_count: 1 },
      ...Array.from({ length: 81 }, (_, index) => ({
        id: `target-${index}`,
        name: `Target ${index + 1}`,
        color: '#65707b',
        string_count: 1,
      })),
    ]
    renderFilters({ tag: 'other' }, tags)
    fireEvent.click(screen.getByRole('button', { name: /^Tag$/ }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search tags…' }), {
      target: { value: 'Target' },
    })

    expect(screen.getByText('Showing 80 of 81. Type to narrow.')).toBeDefined()
    const choices = within(screen.getByRole('list', { name: 'Tag options' }))
    expect(choices.getAllByRole('button')).toHaveLength(81)
    expect(choices.queryByRole('button', { name: 'Target 81' })).toBeNull()
  })
})
