import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi } from '@/lib/api/activities'
import type { Activity } from '@/lib/api/types'
import { stringActivitiesQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { canRestoreHistoryVersion } from '@/features/strings/history-restore'
import { activityActionLabel, activityFieldLabel } from '@/features/activity/activity-copy'
import { useToast } from '@/lib/toast'
import { formatRelativeTime } from '@/lib/utils'

function changePreview(activity: Activity) {
  const change = activity.changed.find((item) => item.field === 'translation') ?? activity.changed[0]
  if (!change) return null
  const label = activityFieldLabel(change)
  if (change.before && change.after) {
    return `${label}: “${change.before}” → “${change.after}”`
  }
  if (!change.after) {
    return `${label}: cleared (was “${change.before}”)`
  }
  return `${label}: set to “${change.after}”`
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
  const { data, isLoading } = useQuery(stringActivitiesQuery(projectId, stringId))

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

  const items = data?.items ?? []

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
    <ol className="flex flex-col gap-3">
      {items.map((activity, index) => (
        <li key={activity.id} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-foreground">
              <span className="font-medium">{activity.actor_label}</span>
              <span className="text-muted-foreground"> · </span>
              <span>{activityActionLabel(activity.event_type)}</span>
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{activity.summary}</p>
            <p className="text-xs text-muted-foreground">
              {formatRelativeTime(activity.created_at)}
            </p>
            {changePreview(activity) ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {changePreview(activity)}
              </p>
            ) : null}
          </div>
          {index > 0 && canRestoreHistoryVersion(activity) ? (
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
  )
}
