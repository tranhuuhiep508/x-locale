import type { ActivityFeedCard } from '@/lib/api/types'

/** Import, Excel/file import, and translate batches can open the catalog. */
const REVIEWABLE_BATCH_KINDS = new Set(['import', 'excel_import', 'translate'])

export type ReviewBatchTarget = {
  batchId: string
  batchKind: string
}

/**
 * Activity cards that should offer "Review this batch".
 * Singles keep their string deep-link. Revert, publish batches, and empty
 * cards do not invent a batch filter.
 */
export function reviewBatchTarget(
  card: Pick<ActivityFeedCard, 'batch_id' | 'batch_kind' | 'children_count'>,
): ReviewBatchTarget | null {
  if (!card.batch_id || card.children_count <= 0) return null
  if (!card.batch_kind || !REVIEWABLE_BATCH_KINDS.has(card.batch_kind)) return null
  return { batchId: card.batch_id, batchKind: card.batch_kind }
}
