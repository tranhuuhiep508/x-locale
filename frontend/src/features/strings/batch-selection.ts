import type { BatchAction, BatchRequest, StringEntry } from '@/lib/api/types'
import { classifyPublishRow } from './publish-preview'
import { canDiscardWorkingCopy } from './working-copy'

export type BatchActionSelection = Record<BatchAction, string[]>

export interface SelectionBatchRequest {
  request: BatchRequest
  selectedCount: number
}

/** Lifecycle actions target only qualifying rows; organization actions keep the full selection. */
export function batchActionSelection(entries: StringEntry[]): BatchActionSelection {
  const all = entries.map((entry) => entry.id)
  const live = entries.filter((entry) => !entry.deleted_at)
  return {
    publish: live.filter((entry) => classifyPublishRow(entry).kind !== 'noop').map((entry) => entry.id),
    unpublish: live.filter((entry) => entry.status === 'public').map((entry) => entry.id),
    delete: live.filter((entry) => !entry.pending_delete).map((entry) => entry.id),
    discard_changes: live.filter(canDiscardWorkingCopy).map((entry) => entry.id),
    discard_delete: live.filter((entry) => entry.pending_delete).map((entry) => entry.id),
    restore: entries.filter((entry) => Boolean(entry.deleted_at)).map((entry) => entry.id),
    // History availability is checked by the server. This count is an upper bound.
    restore_last_history: live.map((entry) => entry.id),
    move_module: all,
    add_tags: all,
    remove_tags: all,
  }
}

export function batchSkippedMessage(selectedCount: number, affected: number, future = false): string {
  const skipped = Math.max(0, selectedCount - affected)
  return skipped > 0
    ? `${skipped} selected string${skipped === 1 ? '' : 's'} ${future ? 'will be skipped' : 'skipped'} because ${skipped === 1 ? 'it does' : 'they do'} not qualify.`
    : ''
}
