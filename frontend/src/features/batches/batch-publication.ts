import type { CliPushPublishRequest, StringEntry } from '@/lib/api/types'

export type BatchDraft = { value: string; score: number | null; source: string }

export function buildBatchPublishItems(
  entries: Pick<StringEntry, 'id'>[],
  drafts: Record<string, BatchDraft>
): CliPushPublishRequest['items'] {
  const byString = new Map<string, Array<[string, BatchDraft]>>()
  for (const [cell, draft] of Object.entries(drafts)) {
    const separator = cell.indexOf(':')
    const id = cell.slice(0, separator)
    const locale = cell.slice(separator + 1)
    const changes = byString.get(id) ?? []
    changes.push([locale, draft])
    byString.set(id, changes)
  }
  return entries.flatMap((entry) => {
    const changes = byString.get(entry.id)
    if (!changes) return []
    return [
      {
        string_id: entry.id,
        expected_source_text: changes[0][1].source,
        translations: Object.fromEntries(changes.map(([locale, draft]) => [locale, draft.value])),
        scores: Object.fromEntries(changes.map(([locale, draft]) => [locale, draft.score])),
      },
    ]
  })
}
