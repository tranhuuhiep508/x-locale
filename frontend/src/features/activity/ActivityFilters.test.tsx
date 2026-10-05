import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActivityFilters } from './ActivityFilters'

afterEach(cleanup)

describe('activity person filter', () => {
  it('applies a trimmed person on Enter and preserves other criteria', () => {
    const onFilter = vi.fn()
    render(
      <ActivityFilters
        search={{ event_type: 'import', locale: 'en' }}
        locales={['en']}
        onFilter={onFilter}
        onClear={vi.fn()}
      />
    )
    const input = screen.getByRole('textbox', { name: 'Filter by person' })
    fireEvent.change(input, { target: { value: '  Dev User  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onFilter).toHaveBeenCalledWith({ actor: 'Dev User' })
    expect((input as HTMLInputElement).value).toBe('Dev User')
  })

  it('clears the visible person together with the filter and follows URL changes', () => {
    const props = { locales: ['en'], onFilter: vi.fn(), onClear: vi.fn() }
    const { rerender } = render(<ActivityFilters {...props} search={{ actor: 'Dev User' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(props.onClear).toHaveBeenCalledOnce()
    expect(
      (screen.getByRole('textbox', { name: 'Filter by person' }) as HTMLInputElement).value
    ).toBe('')
    rerender(<ActivityFilters {...props} search={{ actor: 'Alex' }} />)
    expect(
      (screen.getByRole('textbox', { name: 'Filter by person' }) as HTMLInputElement).value
    ).toBe('Alex')
  })

  it('does not reset pagination when an unchanged person loses focus', () => {
    const onFilter = vi.fn()
    render(
      <ActivityFilters
        search={{ actor: 'Dev User', page: 2 }}
        locales={[]}
        onFilter={onFilter}
        onClear={vi.fn()}
      />
    )
    fireEvent.blur(screen.getByRole('textbox', { name: 'Filter by person' }))
    expect(onFilter).not.toHaveBeenCalled()
  })
})
