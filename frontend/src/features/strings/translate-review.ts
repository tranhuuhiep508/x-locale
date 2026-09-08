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

export function localeCount(items: TranslateProposalItem[]): number {
  let count = 0
  for (const item of items) {
    count += Object.keys(item.translations).length
  }
  return count
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

export function clampPage(page: number, total: number, pageSize: number): number {
  const size = Math.max(1, pageSize)
  const maxPage = Math.max(1, Math.ceil(total / size) || 1)
  return Math.min(Math.max(1, page), maxPage)
}
