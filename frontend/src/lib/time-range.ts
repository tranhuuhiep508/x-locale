export const TIME_PRESETS = [
  { period: '1h', label: 'Last hour', hours: 1 },
  { period: '24h', label: 'Last 24 hours', hours: 24 },
  { period: '7d', label: 'Last 7 days', hours: 168 },
  { period: '14d', label: 'Last 14 days', hours: 336 },
  { period: '30d', label: 'Last 30 days', hours: 720 },
  { period: '90d', label: 'Last 90 days', hours: 2160 },
] as const

export type TimePeriod = (typeof TIME_PRESETS)[number]['period']

const PRESET_HOURS: Record<TimePeriod, number> = Object.fromEntries(
  TIME_PRESETS.map((p) => [p.period, p.hours]),
) as Record<TimePeriod, number>

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const HAS_TZ = /[zZ]|[+-]\d{2}:?\d{2}$/
const HAS_TIME = /T\d{2}:\d{2}| \d{2}:\d{2}/

export type TimeSearchInput = {
  period?: string
  since?: string
  until?: string
  updated_within_days?: 7 | 30
}

export type ResolvedTimeRange = {
  since?: string
  until?: string
}

export function isKnownPeriod(period: string | undefined): period is TimePeriod {
  return period !== undefined && Object.prototype.hasOwnProperty.call(PRESET_HOURS, period)
}

export function normalizeTimeSearch<T extends TimeSearchInput>(search: T): T {
  if (search.period) {
    return {
      ...search,
      ...clearTimeSearch(),
      period: isKnownPeriod(search.period) ? search.period : undefined,
    }
  }
  if (search.since || search.until) {
    return { ...search, updated_within_days: undefined }
  }
  return search
}

export function expandDatetimeParam(value: string, kind: 'since' | 'until'): string {
  const trimmed = value.trim()
  if (DATE_ONLY.test(trimmed)) {
    return kind === 'since'
      ? `${trimmed}T00:00:00.000Z`
      : `${trimmed}T23:59:59.999999Z`
  }
  if (HAS_TZ.test(trimmed)) {
    return trimmed
  }
  if (HAS_TIME.test(trimmed)) {
    return `${trimmed}Z`
  }
  return trimmed
}

export function resolveTimeRange(
  input: TimeSearchInput,
  now: Date = new Date(),
): ResolvedTimeRange {
  const search = normalizeTimeSearch(input)
  if (isKnownPeriod(search.period)) {
    const sinceMs = now.getTime() - PRESET_HOURS[search.period] * 60 * 60 * 1000
    return { since: new Date(sinceMs).toISOString() }
  }
  if (!search.since && !search.until) {
    return {}
  }
  return {
    since: search.since ? expandDatetimeParam(search.since, 'since') : undefined,
    until: search.until ? expandDatetimeParam(search.until, 'until') : undefined,
  }
}

export function resolveStringTimeForApi(input: TimeSearchInput): {
  since?: string
  until?: string
  updated_within_days?: 7 | 30
} {
  const search = normalizeTimeSearch(input)
  const usesNewTime = Boolean(search.period || search.since || search.until)
  if (usesNewTime) {
    const { since, until } = resolveTimeRange(search)
    return { since, until }
  }
  if (search.updated_within_days != null) {
    return { updated_within_days: search.updated_within_days }
  }
  return {}
}

export function clearTimeSearch() {
  return {
    period: undefined,
    since: undefined,
    until: undefined,
    updated_within_days: undefined,
  }
}

export function hasActiveTimeFilter(input: TimeSearchInput): boolean {
  const search = normalizeTimeSearch(input)
  return Boolean(
    search.period ||
      search.since ||
      search.until ||
      search.updated_within_days != null,
  )
}

export function timeRangeLabel(input: TimeSearchInput): string {
  const search = normalizeTimeSearch(input)
  if (search.period && isKnownPeriod(search.period)) {
    return TIME_PRESETS.find((p) => p.period === search.period)!.label
  }
  if (!search.period && !search.since && !search.until && search.updated_within_days) {
    return search.updated_within_days === 7 ? 'Last 7 days' : 'Last 30 days'
  }
  if (search.since || search.until) {
    const sinceDate = search.since ? parseDisplayDate(search.since, 'since') : null
    const untilDate = search.until ? parseDisplayDate(search.until, 'until') : null
    const fmt = (d: Date) =>
      d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    if (sinceDate && untilDate) {
      return `${fmt(sinceDate)} – ${fmt(untilDate)}`
    }
    if (sinceDate) {
      return `From ${fmt(sinceDate)}`
    }
    if (untilDate) {
      return `Until ${fmt(untilDate)}`
    }
  }
  return 'All time'
}

function parseDisplayDate(value: string, kind: 'since' | 'until'): Date {
  return new Date(expandDatetimeParam(value, kind))
}
