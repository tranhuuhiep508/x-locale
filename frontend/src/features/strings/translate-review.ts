import type { TranslateProposalItem, TranslateRequest, TranslationSourceConflict, TranslationMemoryMatch } from '@/lib/api/types'
import type { StringsSearch } from '@/lib/schemas'
import { ApiError } from '@/lib/api/client'
import { searchToBatchFilter } from '@/features/strings/publish-preview'

export const TRANSLATE_MISSING_PAGE_SIZE = 50

export type MissingReviewRequest = Omit<TranslateRequest, 'page'>

/** Capture the queue's filters once per review session, before any paging. */
export function createMissingReviewRequest(
  search: StringsSearch,
  locales: readonly string[],
): MissingReviewRequest {
  const filter = searchToBatchFilter(search)
  if (filter.updated_within_days != null) {
    // The legacy API filter rolls on the server, so freeze it as an absolute
    // cutoff too. Each new review session captures a fresh window.
    filter.since = new Date(Date.now() - filter.updated_within_days * 86_400_000).toISOString()
    filter.updated_within_days = undefined
  }
  return {
    ...filter,
    scope: 'missing',
    locales: [...locales],
    page_size: TRANSLATE_MISSING_PAGE_SIZE,
    q: search.q?.trim() || undefined,
  }
}

export function cloneItem(item: TranslateProposalItem): TranslateProposalItem {
  return {
    ...item,
    description: item.description ?? '',
    translations: { ...item.translations },
    scores: { ...(item.scores ?? {}) },
    issues: item.issues ? { ...item.issues } : item.issues,
    memory_selected: [...(item.memory_selected ?? [])],
  }
}

export function draftsFromItems(
  items: TranslateProposalItem[],
): Record<string, TranslateProposalItem> {
  const drafts: Record<string, TranslateProposalItem> = {}
  for (const item of items) {
    drafts[item.string_id] = cloneItem(item)
  }
  return drafts
}

export function updateDraftTranslation(
  drafts: Record<string, TranslateProposalItem>,
  stringId: string,
  locale: string,
  value: string,
): Record<string, TranslateProposalItem> {
  const row = drafts[stringId]
  if (!row) return drafts
  const scores = { ...(row.scores ?? {}) }
  delete scores[locale]
  const issues = { ...(row.issues ?? {}) }
  delete issues[locale]
  return {
    ...drafts,
    [stringId]: {
      ...row,
      translations: { ...row.translations, [locale]: value },
      memory_selected: value.trim() ? row.memory_selected : row.memory_selected?.filter((selected) => selected !== locale),
      scores,
      issues,
    },
  }
}

export function applyMemoryTranslation(
  drafts: Record<string, TranslateProposalItem>, stringId: string, locale: string, match: TranslationMemoryMatch,
): Record<string, TranslateProposalItem> {
  const next = updateDraftTranslation(drafts, stringId, locale, match.translation)
  const row = next[stringId]
  if (!row) return drafts
  return { ...next, [stringId]: {
    ...row,
    memory_selected: [...new Set([...(row.memory_selected ?? []), locale])],
    issues: { ...row.issues, [locale]: match.issues },
  } }
}

export function excludedMemoryCells(items: TranslateProposalItem[]): Record<string, string[]> {
  return Object.fromEntries(items.flatMap((item) => {
    const locales = item.memory_selected?.filter((locale) => item.translations[locale]?.trim()) ?? []
    return locales.length ? [[item.string_id, locales]] : []
  }))
}

export function updateDraftDescription(
  drafts: Record<string, TranslateProposalItem>,
  stringId: string,
  description: string,
): Record<string, TranslateProposalItem> {
  const row = drafts[stringId]
  if (!row) return drafts
  return { ...drafts, [stringId]: { ...row, description } }
}

export function filledCount(items: TranslateProposalItem[]): number {
  let count = 0
  for (const item of items) {
    for (const value of Object.values(item.translations)) {
      if (value.trim()) count += 1
    }
  }
  return count
}

export function filledStringCount(items: TranslateProposalItem[]): number {
  let count = 0
  for (const item of items) {
    if (Object.values(item.translations).some((value) => value.trim())) count += 1
  }
  return count
}

export function localeCount(items: TranslateProposalItem[]): number {
  let count = 0
  for (const item of items) {
    count += Object.keys(item.translations).length
  }
  return count
}

export function applySuccessMessage(translatedCount: number, stringCount: number): string {
  const translations = translatedCount === 1 ? 'translation' : 'translations'
  const strings = stringCount === 1 ? 'string' : 'strings'
  return `Filled ${translatedCount} empty ${translations} across ${stringCount} ${strings}`
}

export function mergeProposalResults(
  previous: TranslateProposalItem[],
  incoming: TranslateProposalItem[],
): TranslateProposalItem[] {
  const byId = new Map(incoming.map((item) => [item.string_id, item]))
  const seen = new Set<string>()
  const merged: TranslateProposalItem[] = []
  for (const item of previous) {
    const next = byId.get(item.string_id)
    if (next) {
      const sameSource = item.source_text === next.source_text
      const previousTranslations = sameSource
        ? item.translations
        : Object.fromEntries(Object.keys(item.translations).map((locale) => [locale, '']))
      const selected = sameSource ? item.memory_selected ?? [] : []
      const incomingTranslations = Object.fromEntries(Object.entries(next.translations).filter(([locale]) => !selected.includes(locale)))
      const incomingScores = Object.fromEntries(Object.entries(next.scores ?? {}).filter(([locale]) => !selected.includes(locale)))
      const incomingIssues = Object.fromEntries(Object.entries(next.issues ?? {}).filter(([locale]) => !selected.includes(locale)))
      merged.push({
        ...item,
        ...next,
        translations: { ...previousTranslations, ...incomingTranslations },
        memory_selected: selected,
        memory: { ...(sameSource ? item.memory : {}), ...next.memory },
        scores: { ...(sameSource ? item.scores ?? {} : {}), ...incomingScores },
        issues: sameSource
          ? { ...(item.issues ?? {}), ...incomingIssues }
          : { ...incomingIssues },
      })
    } else {
      merged.push(item)
    }
    seen.add(item.string_id)
  }
  for (const item of incoming) {
    if (!seen.has(item.string_id)) merged.push(item)
  }
  return merged
}

function countNoun(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function reviewStatusDescription({
  loadingInitial,
  total,
  pageStringCount,
  missingCount,
  applyCount,
  generated,
}: {
  loadingInitial: boolean
  total: number
  pageStringCount: number
  missingCount: number
  applyCount: number
  generated: boolean
}): string {
  if (loadingInitial) return 'Finding empty locales…'
  if (total === 0) return 'Every target locale already has text.'
  const page = `${pageStringCount} of ${countNoun(total, 'string', 'strings')}`
  if (generated && applyCount > 0) {
    return `${page} · ${countNoun(applyCount, 'translation', 'translations')} filled. Add description context and Translate again if the draft is off.`
  }
  if (missingCount > 0) {
    return `${page} · ${countNoun(missingCount, 'empty locale', 'empty locales')}. Add description context, then Translate.`
  }
  return 'Empty locales only. Existing text was not changed.'
}

export type DescriptionConflict = { string_id: string; key: string; description: string | null }

export function sourceConflicts(error: unknown): TranslationSourceConflict[] {
  if (!(error instanceof ApiError) || error.status !== 409) return []
  const detail = (error.body as { detail?: { code?: string; conflicts?: unknown } } | null)?.detail
  if (detail?.code !== 'stale_translation_source' || !Array.isArray(detail.conflicts)) return []
  return detail.conflicts.filter((item): item is TranslationSourceConflict =>
    item != null && typeof item.string_id === 'string' && typeof item.key === 'string'
    && typeof item.expected_source_text === 'string' && typeof item.source_text === 'string',
  )
}

export function descriptionConflicts(error: unknown): DescriptionConflict[] {
  if (!(error instanceof ApiError) || error.status !== 409) return []
  const detail = (error.body as { detail?: { code?: string; conflicts?: unknown } } | null)?.detail
  if (detail?.code !== 'stale_translation_description' || !Array.isArray(detail.conflicts)) return []
  return detail.conflicts.filter((item): item is DescriptionConflict =>
    item != null && typeof item.string_id === 'string' && typeof item.key === 'string'
    && (item.description === null || typeof item.description === 'string'),
  )
}

export function applyPayloadFromDrafts(
  items: TranslateProposalItem[],
  originals: Record<string, string | null>,
) {
  return items.map((item) => ({
    string_id: item.string_id,
    expected_source_text: item.source_text,
    translations: Object.fromEntries(
      Object.entries(item.translations).filter(([, value]) => value.trim()),
    ),
    scores: item.scores,
    ...((item.description?.trim() || null) !== (originals[item.string_id]?.trim() || null)
      ? { description: item.description?.trim() || null, expected_description: originals[item.string_id] }
      : {}),
  }))
}

export function descriptionsFromDrafts(
  items: TranslateProposalItem[],
): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.string_id, item.description ?? '']))
}

export type TranslateJobProgress = {
  phase?: string
  chunks_done?: number
  chunks_total?: number
}

export function translateProgressPercent(
  progress?: TranslateJobProgress | null,
): number | undefined {
  const total = progress?.chunks_total ?? 0
  if (total <= 0) return undefined
  const done = Math.min(Math.max(progress?.chunks_done ?? 0, 0), total)
  return Math.round((done / total) * 100)
}

export function translateProgressLabel(progress?: TranslateJobProgress | null): string {
  const phase = progress?.phase
  const done = progress?.chunks_done ?? 0
  const total = progress?.chunks_total ?? 0
  if (phase === 'retrying') return 'AI translation is busy, retrying…'
  if (phase === 'filling_gaps') return 'Filling missing locales…'
  if (phase === 'translating' && total > 0) {
    const current = Math.min(Math.max(done < total ? done + 1 : total, 1), total)
    return `Translating batch ${current} of ${total}…`
  }
  if (phase === 'queued') return 'Queued…'
  return 'Generating translations…'
}

export function clampPage(page: number, total: number, pageSize: number): number {
  const size = Math.max(1, pageSize)
  const maxPage = Math.max(1, Math.ceil(total / size) || 1)
  return Math.min(Math.max(1, page), maxPage)
}
