import type { DateRange } from 'react-day-picker'
import { expandDatetimeParam } from '@/lib/time-range'

export type DateRangeValue = {
  since?: string
  until?: string
}

function parseDateParam(value: string | undefined, kind: 'since' | 'until'): Date | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  // Legacy date-only bookmarks name UTC calendar dates. Timestamp bookmarks
  // represent instants, so restore their dates in the browser's timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('-').map(Number)
    if (!year || !month || !day) return undefined
    return new Date(year, month - 1, day)
  }
  const date = new Date(expandDatetimeParam(trimmed, kind))
  if (Number.isNaN(date.getTime())) return undefined
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatDateParam(date: Date, endOfDay = false): string {
  const boundary = new Date(date)
  if (endOfDay) {
    boundary.setHours(23, 59, 59, 999)
    // JavaScript stores milliseconds; the API stores microseconds and uses
    // inclusive upper bounds. Include every instant in the final second.
    return boundary.toISOString().replace('.999Z', '.999999Z')
  }
  boundary.setHours(0, 0, 0, 0)
  return boundary.toISOString()
}

export function dateRangeFromParams(since?: string, until?: string): DateRange | undefined {
  const from = parseDateParam(since, 'since')
  const to = parseDateParam(until, 'until')
  if (!from && !to) return undefined
  return { from, to }
}

export function dateRangeToParams(range: DateRange | undefined): DateRangeValue {
  if (!range?.from) {
    return { since: undefined, until: undefined }
  }
  return {
    since: formatDateParam(range.from),
    until: range.to ? formatDateParam(range.to, true) : undefined,
  }
}
