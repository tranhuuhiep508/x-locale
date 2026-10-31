import type { QaIssue } from '@/lib/api/types'

export const QA_DEBOUNCE_MS = 500
export const QA_SCAN_MIN = 9

export type QaFilter = 'all' | 'issues' | 'errors'

export type QaView = {
  status: 'unchecked' | 'checking' | 'ready' | 'failed'
  /** Findings to show. While checking or after a failed recheck these can be the previous list. */
  issues: QaIssue[]
  stale: boolean
}

export type QaBaseline = {
  source: string
  text: string
  /** Omitted when this source and translation were never checked. `[]` is clean. */
  issues?: QaIssue[]
}

export function issueCounts(issues: readonly QaIssue[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const issue of issues) {
    if (issue.severity === 'error') errors += 1
    else warnings += 1
  }
  return { errors, warnings }
}

export function sortIssues(issues: readonly QaIssue[]): QaIssue[] {
  return [...issues].sort((a, b) => {
    if (a.severity === b.severity) return 0
    return a.severity === 'error' ? -1 : 1
  })
}

type BracePlaceholder = {
  name: string
  type: string | null
  style: string | null
  raw: string
}

function detailCount(issue: QaIssue, key: 'source_count' | 'translation_count'): number | null {
  const value = issue.detail?.[key]
  return typeof value === 'number' ? value : null
}

/** `{name}`, `{name, number}`, or `{name, number, percent}`. Printf tokens are not ICU placeholders. */
function bracePlaceholder(issue: QaIssue): BracePlaceholder | null {
  const raw = issue.detail?.token
  if (typeof raw !== 'string' || !raw.startsWith('{') || !raw.endsWith('}')) return null
  const body = raw.slice(1, -1)
  if (!body || body.includes('{') || body.includes('}')) return null
  const [name, type, ...style] = body.split(', ')
  if (!name) return null
  return {
    name,
    type: type || null,
    style: style.length > 0 ? style.join(', ') : null,
    raw,
  }
}

function isStyleSwap(missing: QaIssue, extra: QaIssue): boolean {
  const missingSource = detailCount(missing, 'source_count')
  const missingTranslation = detailCount(missing, 'translation_count')
  const extraSource = detailCount(extra, 'source_count')
  const extraTranslation = detailCount(extra, 'translation_count')
  if (
    missingSource == null
    || missingTranslation == null
    || extraSource == null
    || extraTranslation == null
  ) return false
  return missingTranslation === 0
    && extraSource === 0
    && missingSource > 0
    && missingSource === extraTranslation
}

/**
 * A typed placeholder that only changed ICU type or format comes back as one
 * missing issue and one extra issue. Show that pair as a single change.
 * Anything else is rendered as the backend sent it.
 */
export function presentQaIssues(issues: readonly QaIssue[]): QaIssue[] {
  const missingAt: number[] = []
  const extraAt: number[] = []
  issues.forEach((issue, index) => {
    if (issue.code === 'placeholder_missing') missingAt.push(index)
    else if (issue.code === 'placeholder_extra') extraAt.push(index)
  })

  const consumed = new Set<number>()
  const groupedAt = new Map<number, QaIssue>()
  for (const index of missingAt) {
    const missing = bracePlaceholder(issues[index])
    if (!missing) continue
    const sameName = (slots: number[]) => slots.filter((slot) => bracePlaceholder(issues[slot])?.name === missing.name)
    if (sameName(missingAt).length !== 1) continue
    const extras = sameName(extraAt).filter((slot) => {
      const extra = bracePlaceholder(issues[slot])
      if (!extra) return false
      if (extra.type === missing.type && extra.style === missing.style) return false
      return isStyleSwap(issues[index], issues[slot])
    })
    if (extras.length !== 1) continue
    const extraSlot = extras[0]
    const extra = bracePlaceholder(issues[extraSlot])
    if (!extra) continue
    consumed.add(index)
    consumed.add(extraSlot)
    groupedAt.set(index, {
      code: 'placeholder_changed',
      severity: 'error',
      message: `Placeholder ${missing.name} changed from ${missing.raw} to ${extra.raw}.`,
      start: null,
      end: null,
      detail: null,
    })
  }

  const presented: QaIssue[] = []
  issues.forEach((issue, index) => {
    if (consumed.has(index) && !groupedAt.has(index)) return
    presented.push(groupedAt.get(index) ?? issue)
  })
  return sortIssues(presented)
}

export function shouldShowQaIndex(stringCount: number, filter: QaFilter): boolean {
  return stringCount >= QA_SCAN_MIN && filter !== 'all'
}

export function shouldFoldCleanLocales(stringCount: number): boolean {
  return stringCount >= QA_SCAN_MIN
}
