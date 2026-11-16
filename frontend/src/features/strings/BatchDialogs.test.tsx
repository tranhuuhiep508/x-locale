import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Tag } from '@/lib/api/types'
import { BatchTagDialog } from './BatchDialogs'

const tags: Tag[] = [
  { id: 'first', name: 'First', color: '#2563eb', string_count: 0 },
  { id: 'second', name: 'Second', color: '#2563eb', string_count: 0 },
]

describe('BatchTagDialog', () => {
  it('applies only the selected tag', () => {
    const onApply = vi.fn()
    render(<BatchTagDialog open onClose={vi.fn()} tags={tags} onApply={onApply} isLoading={false} />)

    const options = screen.getByRole('group', { name: 'Choose tag' })
    const first = within(options).getByRole('button', { name: 'First' })
    const second = within(options).getByRole('button', { name: 'Second' })
    const apply = screen.getByRole('button', { name: 'Set tag' })
    expect((apply as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(first)
    fireEvent.click(second)
    expect(first.getAttribute('aria-pressed')).toBe('false')
    expect(second.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(apply)
    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply).toHaveBeenCalledWith('second')
  })

  it('requires a fresh tag selection each time the dialog opens', () => {
    const onApply = vi.fn()
    const props = { onClose: vi.fn(), tags, onApply, isLoading: false }
    const { rerender } = render(<BatchTagDialog {...props} open />)

    fireEvent.click(within(screen.getByRole('group', { name: 'Choose tag' })).getByRole('button', { name: 'First' }))
    rerender(<BatchTagDialog {...props} open={false} />)
    rerender(<BatchTagDialog {...props} open />)

    const first = within(screen.getByRole('group', { name: 'Choose tag' })).getByRole('button', { name: 'First' })
    expect(first.getAttribute('aria-pressed')).toBe('false')
    const apply = screen.getByRole('button', { name: 'Set tag' }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    fireEvent.click(apply)
    expect(onApply).not.toHaveBeenCalled()
  })
})
