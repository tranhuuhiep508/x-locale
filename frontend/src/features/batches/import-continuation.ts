import type { ImportResult } from '@/lib/api/types'

/**
 * The batch to continue reviewing after an import, or null when there is nothing to review:
 * dry runs write nothing under their batch id and no-op imports record no activity.
 */
export function importReviewBatchId(
  result: Pick<ImportResult, 'batch_id' | 'dry_run' | 'created' | 'updated'> | Record<string, unknown> | null | undefined
): string | null {
  if (!result || result.dry_run === true) return null
  const batchId = typeof result.batch_id === 'string' ? result.batch_id : null
  const writes = Number(result.created ?? 0) + Number(result.updated ?? 0)
  return batchId && writes > 0 ? batchId : null
}
