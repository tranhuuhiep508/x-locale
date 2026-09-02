import { describe, expect, it } from 'vitest'
import { parseApiDate, formatRelativeTime } from '@/lib/utils'

describe('parseApiDate', () => {
  it('treats naive ISO timestamps as UTC', () => {
    expect(parseApiDate('2026-09-02T08:00:00').toISOString()).toBe('2026-09-02T08:00:00.000Z')
    expect(parseApiDate('2026-09-02T08:00:00.547948').toISOString()).toBe(
      '2026-09-02T08:00:00.547Z',
    )
  })

  it('keeps explicit offsets', () => {
    expect(parseApiDate('2026-09-02T08:00:00Z').toISOString()).toBe('2026-09-02T08:00:00.000Z')
    expect(parseApiDate('2026-09-02T15:00:00+07:00').toISOString()).toBe(
      '2026-09-02T08:00:00.000Z',
    )
  })
})

describe('formatRelativeTime', () => {
  it('treats naive ISO the same as UTC', () => {
    const zulu = new Date(Date.now() - 10_000).toISOString()
    const naive = zulu.replace('Z', '')
    expect(formatRelativeTime(naive)).toBe(formatRelativeTime(zulu))
  })
})
