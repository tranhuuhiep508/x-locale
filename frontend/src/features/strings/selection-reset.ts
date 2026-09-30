import { useEffect } from 'react'
import type { RowSelectionState } from '@tanstack/react-table'
import type { StringsSearch } from '@/lib/schemas'

/** Catalog filters that replace the visible row set. Page size and page do not. */
export type SelectionResetSearch = Pick<
  StringsSearch,
  | 'has_unpublished_changes'
  | 'status'
  | 'module'
  | 'tag'
  | 'deleted'
  | 'pending_delete'
  | 'q'
  | 'missing_locale'
  | 'max_confidence'
  | 'batch_id'
>

/**
 * Drop grid selection when the catalog filter changes.
 * `batch_id` is included so clearing the batch chip cannot leave soft-deleted
 * ids selected for a later batch action.
 */
export function useClearStringSelection(
  search: SelectionResetSearch,
  setRowSelection: (selection: RowSelectionState) => void,
) {
  useEffect(() => {
    setRowSelection({})
  }, [
    search.has_unpublished_changes,
    search.status,
    search.module,
    search.tag,
    search.deleted,
    search.pending_delete,
    search.q,
    search.missing_locale,
    search.max_confidence,
    search.batch_id,
    setRowSelection,
  ])
}
