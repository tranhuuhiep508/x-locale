import type { StringEntry, TranslateProposalItem, TranslateRequest, TranslateSaveResult, TranslationSourceConflict, TranslationMemoryMatch } from '@/lib/api/types'
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
    memory_choice: item.memory_choice ? { ...item.memory_choice } : item.memory_choice,
  }
}

function choiceWithout(
  choice: Record<string, string> | undefined,
  locale: string,
): Record<string, string> | undefined {
  if (!choice || !(locale in choice)) return choice
  const next = { ...choice }
  delete next[locale]
  return next
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
      memory_choice: value.trim() ? row.memory_choice : choiceWithout(row.memory_choice, locale),
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
    memory_choice: { ...(row.memory_choice ?? {}), [locale]: match.string_id },
    issues: { ...row.issues, [locale]: match.issues },
  } }
}

export function excludedMemoryCells(items: TranslateProposalItem[]): Record<string, string[]> {
  return Object.fromEntries(items.flatMap((item) => {
    const locales = item.memory_selected?.filter((locale) => item.translations[locale]?.trim()) ?? []
    return locales.length ? [[item.string_id, locales]] : []
  }))
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

export function localeCount(items: TranslateProposalItem[]): number {
  let count = 0
  for (const item of items) {
    count += Object.keys(item.translations).length
  }
  return count
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
      const choice = sameSource
        ? Object.fromEntries(Object.entries(item.memory_choice ?? {}).filter(([locale]) => selected.includes(locale)))
        : undefined
      const incomingTranslations = Object.fromEntries(Object.entries(next.translations).filter(([locale]) => !selected.includes(locale)))
      const incomingScores = Object.fromEntries(Object.entries(next.scores ?? {}).filter(([locale]) => !selected.includes(locale)))
      const incomingIssues = Object.fromEntries(Object.entries(next.issues ?? {}).filter(([locale]) => !selected.includes(locale)))
      merged.push({
        ...item,
        ...next,
        translations: { ...previousTranslations, ...incomingTranslations },
        memory_selected: selected,
        memory_choice: choice,
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
}: {
  loadingInitial: boolean
  total: number
  pageStringCount: number
  missingCount: number
  applyCount: number
}): string {
  if (loadingInitial) return 'Finding empty locales…'
  if (total === 0) return 'Every target locale already has text.'
  const scope = total > pageStringCount
    ? `${pageStringCount} of ${countNoun(total, 'string', 'strings')}`
    : countNoun(total, 'string', 'strings')
  if (applyCount > 0) {
    return `${scope} · ${countNoun(applyCount, 'translation', 'translations')} ready`
  }
  if (missingCount > 0) {
    return `${scope} · ${missingCount} missing`
  }
  return scope
}

export function sourceConflicts(error: unknown): TranslationSourceConflict[] {
  if (!(error instanceof ApiError) || error.status !== 409) return []
  const detail = (error.body as { detail?: { code?: string; conflicts?: unknown } } | null)?.detail
  if (detail?.code !== 'stale_translation_source' || !Array.isArray(detail.conflicts)) return []
  return detail.conflicts.filter((item): item is TranslationSourceConflict =>
    item != null && typeof item.string_id === 'string' && typeof item.key === 'string'
    && typeof item.expected_source_text === 'string' && typeof item.source_text === 'string',
  )
}

export function applyPayloadFromDrafts(items: TranslateProposalItem[]) {
  return items.map((item) => ({
    string_id: item.string_id,
    expected_source_text: item.source_text,
    translations: Object.fromEntries(
      Object.entries(item.translations).filter(([, value]) => value.trim()),
    ),
    scores: item.scores,
  }))
}

/** Only rows with a filled translation cell. */
export function reviewedPayloadFromDrafts(items: TranslateProposalItem[]) {
  return applyPayloadFromDrafts(items).filter(
    (item) => Object.keys(item.translations).length > 0,
  )
}

export type ValueConflict = { string_id: string; key: string; locale: string; value: string }

export function valueConflicts(error: unknown): ValueConflict[] {
  if (!(error instanceof ApiError) || error.status !== 409) return []
  const detail = (error.body as { detail?: { code?: string; conflicts?: unknown } } | null)?.detail
  if (detail?.code !== 'stale_translation_value' || !Array.isArray(detail.conflicts)) return []
  return detail.conflicts.filter((item): item is ValueConflict =>
    item != null && typeof item.string_id === 'string' && typeof item.key === 'string'
    && typeof item.locale === 'string' && typeof item.value === 'string',
  )
}

export function valueConflictMessage(conflicts: ValueConflict[]): string {
  const cells = conflicts.map((item) => `${item.key} (${item.locale.toUpperCase()})`).join(', ')
  return `Filled elsewhere since review: ${cells}. Nothing was saved. Clear these cells to keep the saved text, then try again.`
}

export function saveSuccessMessage(result: TranslateSaveResult): string {
  const strings = `${result.string_count} ${result.string_count === 1 ? 'string' : 'strings'}`
  if (result.action === 'publish') {
    const published = `${result.published_count} ${result.published_count === 1 ? 'string' : 'strings'}`
    return `Saved and published ${published}. Available on the next public pull or export.`
  }
  return `Saved ${strings} as draft. Public translations are unchanged.`
}

/** Locales that would export empty for each string once published. */
export function emptyPublicLocales(entries: StringEntry[]): Array<{ id: string; key: string; locales: string[] }> {
  return entries.flatMap((entry) => {
    const locales = entry.translations
      .filter((translation) => !(translation.value ?? '').trim())
      .map((translation) => translation.locale)
      .sort()
    return locales.length ? [{ id: entry.id, key: entry.key, locales }] : []
  })
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
