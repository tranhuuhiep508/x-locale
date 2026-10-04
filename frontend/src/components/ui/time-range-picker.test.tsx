import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeRangePicker } from '@/components/ui/time-range-picker'

afterEach(cleanup)

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
