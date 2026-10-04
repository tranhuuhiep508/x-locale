import { describe, expect, it } from 'vitest'
import { dateRangeFromParams, dateRangeToParams } from '@/lib/date-range-params'
import { resolveTimeRange } from '@/lib/time-range'

describe('dateRangeToParams', () => {
  it.each([
    { name: 'January range', from: new Date(2026, 0, 10), to: new Date(2026, 0, 12) },
    { name: 'spring DST day', from: new Date(2026, 2, 8), to: new Date(2026, 2, 8) },
    { name: 'autumn DST day', from: new Date(2026, 10, 1), to: new Date(2026, 10, 1) },
  ])('preserves local day boundaries and restores $name', ({ from, to }) => {
    const params = dateRangeToParams({ from, to })
    const resolved = resolveTimeRange(params)
    expect(resolved).toEqual(params)
    expect(new Date(resolved.since!)).toEqual(from)
    const end = new Date(to)
    end.setHours(23, 59, 59, 999)
    expect(new Date(resolved.until!)).toEqual(end)
    expect(params.until).toMatch(/\.999999Z$/)
    expect(dateRangeFromParams(params.since, params.until)).toEqual({ from, to })
    expect(from.getHours()).toBe(0)
    expect(to.getHours()).toBe(0)

    if (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Los_Angeles') {
      const hours = (end.getTime() + 1 - from.getTime()) / 3_600_000
      if (from.getMonth() === 2) expect(hours).toBe(23)
      if (from.getMonth() === 10) expect(hours).toBe(25)
    }
  })

  it('includes the fractional final second but excludes the next midnight', () => {
    const params = dateRangeToParams({ from: new Date(2026, 0, 10), to: new Date(2026, 0, 12) })
    const until = new Date(resolveTimeRange(params).until!).getTime()
    expect(new Date(2026, 0, 12, 23, 59, 59, 500).getTime()).toBeLessThanOrEqual(until)
    expect(new Date(2026, 0, 13).getTime()).toBeGreaterThan(until)
  })
})

describe('dateRangeFromParams', () => {
  it('keeps legacy date-only calendar dates', () => {
    const range = dateRangeFromParams('2026-01-10', '2026-01-12')
    expect(range?.from).toEqual(new Date(2026, 0, 10))
    expect(range?.to).toEqual(new Date(2026, 0, 12))
  })

  it('maps timestamps with offsets back to local calendar dates', () => {
    const since = '2026-01-10T00:00:00-08:00'
    const until = '2026-01-12T23:59:59.999999-08:00'
    const localDay = (value: string) => {
      const date = new Date(value)
      return new Date(date.getFullYear(), date.getMonth(), date.getDate())
    }
    expect(dateRangeFromParams(since, until)).toEqual({
      from: localDay(since), to: localDay(until),
    })
  })

  it('continues to interpret legacy timestamps without a timezone as UTC', () => {
    const value = '2026-01-10T00:00:00'
    const date = new Date(`${value}Z`)
    expect(dateRangeFromParams(value)?.from).toEqual(
      new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    )
  })

  it('ignores invalid timestamp bookmarks', () => {
    expect(dateRangeFromParams('not-a-date', 'also-invalid')).toBeUndefined()
  })
})
