import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { activitiesApi } from '@/lib/api/activities'
import type { Activity } from '@/lib/api/types'
import { stringActivitiesInfiniteQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { shouldShowHistoryRestore } from '@/features/strings/history-restore'
import { useToast } from '@/lib/toast'
import { formatRelativeTime } from '@/lib/utils'

function changePreview(activity: Activity) {
  const change = activity.changed.find((item) => item.field === 'translation') ?? activity.changed[0]
  if (!change) return null
  const label = change.locale ?? change.field
  if (change.before && change.after) {
    return `${label}: “${change.before}” → “${change.after}”`
  }
  return `${label}: “${change.after ?? change.before ?? ''}”`
}

export function StringHistoryPanel({
  projectId,
  stringId,
  onRestored,
}: {
  projectId: string
  stringId: string
  onRestored: () => void
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery(
    stringActivitiesInfiniteQuery(projectId, stringId),
  )

  const restoreMut = useMutation({
    mutationFn: (activityId: string) =>
      activitiesApi.restoreVersion(projectId, stringId, activityId),
    onSuccess: (result) => {
      if (result.pending_delete) {
        toast.warning(result.notice)
      } else {
        toast.info(result.notice)
      }
      qc.invalidateQueries({ queryKey: queryKeys.projects.activities.all(projectId) })
      qc.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
      onRestored()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Restore failed'),
  })

  const items = data?.pages.flatMap((page) => page.items) ?? []

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No history yet for this string.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {items.map((activity, index) => (
          <li key={activity.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-foreground">{activity.summary}</p>
              <p className="text-xs text-muted-foreground">
                {activity.actor_label} · {formatRelativeTime(activity.created_at)}
              </p>
              {changePreview(activity) ? (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {changePreview(activity)}
                </p>
              ) : null}
            </div>
            {shouldShowHistoryRestore(index, activity) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={restoreMut.isPending}
                onClick={() => restoreMut.mutate(activity.id)}
              >
                Restore
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
      {hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          {isFetchingNextPage ? 'Loading…' : 'Load older'}
        </Button>
      ) : null}
    </div>
  )
}
