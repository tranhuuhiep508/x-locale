import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeRangePicker } from '@/components/ui/time-range-picker'
import { dateRangeToParams } from '@/lib/date-range-params'
import { timeRangeLabel } from '@/lib/time-range'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TimeRangePicker mixed time parameters', () => {
  it.each(['7d', 'bogus', 'constructor'])(
    'ignores stale calendar dates when period is %s',
    (period) => {
      const onChange = vi.fn()
      render(<TimeRangePicker
        value={{ period, since: '2026-01-10', until: '2026-01-12' }}
        onChange={onChange}
      />)

      const label = period === '7d' ? 'Last 7 days' : 'All time'
      fireEvent.click(screen.getByRole('button', { name: label }))
      fireEvent.click(screen.getByRole('button', { name: 'Apply range' }))

      expect(onChange).not.toHaveBeenCalled()
      expect(screen.getByText('Choose a start and end date.')).toBeTruthy()
    },
  )
})

describe('TimeRangePicker saved ranges', () => {
  it('opens at the saved month and restores local dates on Apply', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    const value = dateRangeToParams({ from: new Date(2026, 0, 10), to: new Date(2026, 0, 12) })
    const onChange = vi.fn()
    render(<TimeRangePicker value={value} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: timeRangeLabel(value) }))
    expect(screen.getByTestId('time-range-calendar').textContent).toContain('January 2026')
    fireEvent.click(screen.getByRole('button', { name: 'Apply range' }))
    expect(onChange).toHaveBeenCalledWith({
      ...value, period: undefined, updated_within_days: undefined,
    })
  })

  it('seeds the latest range before each open and preserves month navigation', () => {
    const onChange = vi.fn()
    const january = { since: '2026-01-10', until: '2026-01-12' }
    const april = { since: '2026-04-10', until: '2026-04-12' }
    const { rerender } = render(<TimeRangePicker value={january} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: timeRangeLabel(january) }))
    expect(screen.getByTestId('time-range-calendar').textContent).toContain('January 2026')
    fireEvent.click(screen.getByRole('button', { name: 'Go to the Next Month' }))
    expect(screen.getByTestId('time-range-calendar').textContent).toContain('March 2026')
    fireEvent.click(screen.getByRole('button', { name: timeRangeLabel(january) }))
    rerender(<TimeRangePicker value={april} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: timeRangeLabel(april) }))
    expect(screen.getByTestId('time-range-calendar').textContent).toContain('April 2026')
  })

  it('updates the range and month when the URL changes while open', () => {
    const onChange = vi.fn()
    const january = dateRangeToParams({ from: new Date(2026, 0, 10), to: new Date(2026, 0, 12) })
    const april = dateRangeToParams({ from: new Date(2026, 3, 10), to: new Date(2026, 3, 12) })
    const { rerender } = render(<TimeRangePicker value={january} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: timeRangeLabel(january) }))
    rerender(<TimeRangePicker value={april} onChange={onChange} />)
    expect(screen.getByTestId('time-range-calendar').textContent).toContain('April 2026')
    fireEvent.click(screen.getByRole('button', { name: 'Apply range' }))
    expect(onChange).toHaveBeenCalledWith({
      ...april, period: undefined, updated_within_days: undefined,
    })
  })
})
