import { describe, expect, it } from 'vitest'
import { dateRangeFromParams, dateRangeToParams } from '@/lib/date-range-params'

describe('dateRangeToParams', () => {
  it('maps a local calendar range to since/until day bounds', () => {
    const from = new Date(2026, 0, 10)
    const to = new Date(2026, 0, 12)
    expect(dateRangeToParams({ from, to })).toEqual({
      since: '2026-01-10T00:00:00',
      until: '2026-01-12T23:59:59',
    })
  })
})

describe('dateRangeFromParams', () => {
  it('parses date-only and datetime bookmarks', () => {
    const range = dateRangeFromParams('2026-01-10', '2026-01-12T23:59:59')
    expect(range?.from).toEqual(new Date(2026, 0, 10))
    expect(range?.to).toEqual(new Date(2026, 0, 12))
  })
})
