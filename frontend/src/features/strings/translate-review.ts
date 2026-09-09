import type { TranslateProposalItem } from '@/lib/api/types'

export const TRANSLATE_MISSING_PAGE_SIZE = 50

export function cloneItem(item: TranslateProposalItem): TranslateProposalItem {
  return {
    ...item,
    description: item.description ?? '',
    translations: { ...item.translations },
    scores: { ...(item.scores ?? {}) },
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
  return {
    ...drafts,
    [stringId]: {
      ...row,
      translations: { ...row.translations, [locale]: value },
      scores,
    },
  }
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
      merged.push({
        ...item,
        ...next,
        translations: { ...item.translations, ...next.translations },
        scores: { ...(item.scores ?? {}), ...(next.scores ?? {}) },
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

export function applyPayloadFromDrafts(items: TranslateProposalItem[]) {
  return items.map((item) => ({
    string_id: item.string_id,
    translations: Object.fromEntries(
      Object.entries(item.translations).filter(([, value]) => value.trim()),
    ),
    scores: item.scores,
    description: item.description ?? '',
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
  if (phase === 'retrying') return 'Bedrock is busy, retrying…'
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
