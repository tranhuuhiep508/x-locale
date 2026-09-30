import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { RowSelectionState } from '@tanstack/react-table'
import {
  useClearStringSelection,
  type SelectionResetSearch,
} from '@/features/strings/selection-reset'

const BATCH = '11111111-1111-4111-8111-111111111111'

function Probe({ search }: { search: SelectionResetSearch }) {
  const [selection, setSelection] = useState<RowSelectionState>({})
  useClearStringSelection(search, setSelection)
  const selected = Object.keys(selection)
    .filter((id) => selection[id])
    .sort()
    .join(',')
  return (
    <div>
      <button
        type="button"
        onClick={() => setSelection({ 'soft-deleted': true, 'live-row': true })}
      >
        select
      </button>
      <span data-testid="selected">{selected || 'none'}</span>
    </div>
  )
}

describe('useClearStringSelection', () => {
  it('drops selected ids, including soft-deleted rows, when batch_id is cleared', () => {
    const { rerender } = render(<Probe search={{ batch_id: BATCH }} />)
    fireEvent.click(screen.getByRole('button', { name: 'select' }))
    expect(screen.getByTestId('selected').textContent).toBe('live-row,soft-deleted')

    rerender(<Probe search={{ batch_id: undefined }} />)
    expect(screen.getByTestId('selected').textContent).toBe('none')
  })

  it('drops selected ids when the batch filter changes to another batch', () => {
    const { rerender } = render(<Probe search={{ batch_id: BATCH }} />)
    fireEvent.click(screen.getByRole('button', { name: 'select' }))

    rerender(<Probe search={{ batch_id: '22222222-2222-4222-8222-222222222222' }} />)
    expect(screen.getByTestId('selected').textContent).toBe('none')
  })

  it('keeps the selection when the batch filter is unchanged', () => {
    const search = { batch_id: BATCH, q: 'review' }
    const { rerender } = render(<Probe search={search} />)
    fireEvent.click(screen.getByRole('button', { name: 'select' }))

    rerender(<Probe search={{ ...search }} />)
    expect(screen.getByTestId('selected').textContent).toBe('live-row,soft-deleted')
  })

  it('still clears when another catalog filter changes', () => {
    const { rerender } = render(<Probe search={{ batch_id: BATCH, module: 'auth' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'select' }))

    rerender(<Probe search={{ batch_id: BATCH, module: 'home' }} />)
    expect(screen.getByTestId('selected').textContent).toBe('none')
  })
})
