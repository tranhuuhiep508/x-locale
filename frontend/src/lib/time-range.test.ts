import { describe, expect, it } from 'vitest'
import {
  clearTimeSearch,
  expandDatetimeParam,
  hasActiveTimeFilter,
  isKnownPeriod,
  resolveTimeRange,
  resolveStringTimeForApi,
  timeRangeLabel,
} from '@/lib/time-range'

describe('resolveTimeRange', () => {
  const now = new Date('2026-03-08T15:30:00.000Z')

  it('computes exact hour offsets for presets', () => {
    expect(resolveTimeRange({ period: '1h' }, now)).toEqual({
      since: '2026-03-08T14:30:00.000Z',
    })
    expect(resolveTimeRange({ period: '7d' }, now)).toEqual({
      since: '2026-03-01T15:30:00.000Z',
    })
    expect(resolveTimeRange({ period: '90d' }, now)).toEqual({
      since: '2025-12-08T15:30:00.000Z',
    })
  })

  it('keeps 7d stable across a US DST spring-forward boundary', () => {
    const dstNow = new Date('2026-03-08T07:00:00.000Z')
    const resolved = resolveTimeRange({ period: '7d' }, dstNow)
    expect(resolved.since).toBe('2026-03-01T07:00:00.000Z')
    expect(
      new Date(dstNow).getTime() - new Date(resolved.since!).getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('ignores since/until when period is set', () => {
    expect(
      resolveTimeRange(
        { period: '24h', since: '2020-01-01T00:00:00.000Z', until: '2020-01-02T00:00:00.000Z' },
        now,
      ),
    ).toEqual({ since: '2026-03-07T15:30:00.000Z' })
  })

  it.each(['bogus', 'constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'falls back to all time for unknown period %s',
    (period) => {
      expect(isKnownPeriod(period)).toBe(false)
      expect(resolveTimeRange({ period }, now)).toEqual({})
      expect(timeRangeLabel({ period })).toBe('All time')
    },
  )

  it('expands date-only bookmarks to UTC day bounds', () => {
    expect(resolveTimeRange({ since: '2026-01-10', until: '2026-01-12' }, now)).toEqual({
      since: '2026-01-10T00:00:00.000Z',
      until: '2026-01-12T23:59:59.999999Z',
    })
  })

  it('allows an open end when until is omitted', () => {
    expect(resolveTimeRange({ since: '2026-01-10' }, now)).toEqual({
      since: '2026-01-10T00:00:00.000Z',
    })
  })

  it('uses all time consistently when an unknown period is mixed with absolute and legacy bounds', () => {
    const search = {
      period: 'bogus',
      since: '2026-01-10',
      until: '2026-01-12',
      updated_within_days: 7 as const,
    }
    expect(resolveTimeRange(search, now)).toEqual({})
    expect(resolveStringTimeForApi(search)).toEqual({})
    expect(timeRangeLabel(search)).toBe('All time')
    expect(hasActiveTimeFilter(search)).toBe(false)
  })
})

describe('expandDatetimeParam', () => {
  it('appends Z to legacy time strings without a zone', () => {
    expect(expandDatetimeParam('2026-01-10T00:00:00', 'since')).toBe('2026-01-10T00:00:00Z')
    expect(expandDatetimeParam('2026-01-12T23:59:59', 'until')).toBe('2026-01-12T23:59:59Z')
  })
})

describe('clearTimeSearch', () => {
  it('clears only time fields', () => {
    expect(clearTimeSearch()).toEqual({
      period: undefined,
      since: undefined,
      until: undefined,
      updated_within_days: undefined,
    })
    expect(hasActiveTimeFilter({ period: '7d' })).toBe(true)
    expect(hasActiveTimeFilter(clearTimeSearch())).toBe(false)
  })
})
