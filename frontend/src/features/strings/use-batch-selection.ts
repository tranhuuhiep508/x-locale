import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { RowSelectionState } from '@tanstack/react-table'
import { stringsApi } from '@/lib/api/strings'
import type { StringEntry } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { batchActionSelection } from './batch-selection'

/** Use visible rows directly; hydrate off-page selections with one read-only request. */
export function useBatchSelection(
  projectId: string,
  rowSelection: RowSelectionState,
  visibleEntries: StringEntry[],
) {
  const ids = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]).sort(),
    [rowSelection],
  )
  const visibleSelected = useMemo(
    () => visibleEntries.filter((entry) => rowSelection[entry.id]),
    [visibleEntries, rowSelection],
  )
  const needsLookup = ids.length > visibleSelected.length
  const selectedQuery = useQuery({
    queryKey: queryKeys.projects.strings.selection(projectId, ids),
    queryFn: () => stringsApi.publishPreview(projectId, { string_ids: ids }),
    enabled: needsLookup,
    retry: false,
  })
  const entries = needsLookup ? selectedQuery.data?.items ?? [] : visibleSelected
  const actions = useMemo(() => batchActionSelection(entries), [entries])
  const ready = !needsLookup || (selectedQuery.isSuccess && !selectedQuery.isFetching)
  const error = needsLookup && selectedQuery.isError
  return {
    ids,
    entries,
    actions,
    ready,
    checking: needsLookup && selectedQuery.isFetching,
    error,
    retry: selectedQuery.refetch,
  }
}
