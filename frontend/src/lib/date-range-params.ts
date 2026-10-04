import type { DateRange } from 'react-day-picker'

export type DateRangeValue = {
  since?: string
  until?: string
}

function parseDateParam(value?: string): Date | undefined {
  if (!value) return undefined
  const datePart = value.slice(0, 10)
  const [year, month, day] = datePart.split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function formatDateParam(date: Date, endOfDay = false): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return endOfDay ? `${year}-${month}-${day}T23:59:59` : `${year}-${month}-${day}T00:00:00`
}

export function dateRangeFromParams(since?: string, until?: string): DateRange | undefined {
  const from = parseDateParam(since)
  const to = parseDateParam(until)
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
