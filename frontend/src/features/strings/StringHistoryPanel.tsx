import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi } from '@/lib/api/activities'
import { ApiError } from '@/lib/api/client'
import type { ActivityChange, RestorePreview } from '@/lib/api/types'
import { restoreVersionPreviewQuery, stringActivitiesInfiniteQuery } from '@/lib/queries'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ActivityDetailSheet } from '@/features/activity/ActivityDetailSheet'
import { PreviewFailure } from '@/features/activity/PreviewFailure'
import { changeDisplayValue, changeFieldLabel } from '@/features/activity/change-labels'
import {
  historyRestoreBlockedReason,
  isHistoryRestoreEnabled,
  shouldShowHistoryRestore,
} from '@/features/strings/history-restore'
import { useToast } from '@/lib/toast'
import { formatRelativeTime } from '@/lib/utils'

const VISIBLE_CHANGES = 4

function changeKey(change: ActivityChange) {
  return `${change.scope}:${change.field}:${change.locale ?? ''}:${change.before}:${change.after}`
}

export function ChangeLine({
  change,
  wrap = false,
  preview = false,
}: {
  change: ActivityChange
  wrap?: boolean
  preview?: boolean
}) {
  const label =
    change.scope === 'published'
      ? `${changeFieldLabel(change)} (published)`
      : changeFieldLabel(change)
  const before = changeDisplayValue(change, change.before)
  const after = changeDisplayValue(change, change.after)
  const lineClass = wrap
    ? 'break-words text-xs text-muted-foreground'
    : 'truncate text-xs text-muted-foreground'
  if (!preview && !change.before) {
    return (
      <p className={lineClass}>
        <span className="font-medium text-foreground/80">{label}</span> “{after}”
      </p>
    )
  }
  if (!preview && !change.after) {
    return (
      <p className={lineClass}>
        <span className="font-medium text-foreground/80">{label}</span> “{before}”
      </p>
    )
  }
  return (
    <p className={lineClass}>
      <span className="font-medium text-foreground/80">{label}</span> “{before}” → “{after}”
    </p>
  )
}

function RestorePreviewBody({ preview }: { preview: RestorePreview | undefined }) {
  if (!preview) {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading preview…
      </span>
    )
  }
  return (
    <div className="flex flex-col gap-2 text-left">
      <p>{preview.notice ?? preview.blocked_reason}</p>
      {preview.changes.length > 0 ? (
        <div className="flex max-h-48 min-w-0 flex-col gap-1 overflow-y-auto rounded-md border p-2">
          {preview.changes.map((change) => (
            <ChangeLine key={changeKey(change)} change={change} wrap preview />
          ))}
        </div>
      ) : null}
    </div>
  )
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
    stringActivitiesInfiniteQuery(projectId, stringId)
  )

  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const previewQuery = useQuery({
    ...restoreVersionPreviewQuery(projectId, stringId, restoreTarget ?? ''),
    enabled: restoreTarget !== null,
  })
  const preview = previewQuery.data

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
      setRestoreTarget(null)
      onRestored()
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : 'Restore failed')
      if (e instanceof ApiError && e.status === 409) {
        void previewQuery.refetch()
      }
    },
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
        {items.map((activity, index) => {
          const show = shouldShowHistoryRestore(index)
          const enabled = isHistoryRestoreEnabled(index, activity)
          const blockedReason = historyRestoreBlockedReason(activity)
          const visibleChanges = activity.changed.slice(0, VISIBLE_CHANGES)
          const extra = Math.max(0, activity.changed_count - visibleChanges.length)
          return (
            <li key={activity.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{activity.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {activity.actor_label} · {formatRelativeTime(activity.created_at)}
                </p>
                <div className="mt-0.5 flex flex-col gap-0.5">
                  {visibleChanges.map((change) => (
                    <ChangeLine key={changeKey(change)} change={change} />
                  ))}
                  {extra > 0 ? (
                    <button
                      type="button"
                      className="text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      onClick={() => setDetailId(activity.id)}
                    >
                      +{extra} more change{extra === 1 ? '' : 's'}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetailId(activity.id)}
                >
                  View details
                </Button>
                {show ? (
                  enabled ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={restoreMut.isPending}
                      onClick={() => setRestoreTarget(activity.id)}
                    >
                      Restore working copy
                    </Button>
                  ) : (
                    <Tooltip delayDuration={200}>
                      <TooltipTrigger asChild>
                        <span>
                          <Button type="button" variant="ghost" size="sm" disabled>
                            Restore working copy
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{blockedReason}</TooltipContent>
                    </Tooltip>
                  )
                ) : null}
              </div>
            </li>
          )
        })}
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

      <ConfirmDialog
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => restoreTarget && restoreMut.mutate(restoreTarget)}
        title="Restore working copy?"
        description={
          previewQuery.isError ? (
            <PreviewFailure
              error={previewQuery.error}
              onRetry={() => {
                void previewQuery.refetch()
              }}
            />
          ) : (
            <RestorePreviewBody preview={previewQuery.isFetching ? undefined : preview} />
          )
        }
        confirmLabel="Restore working copy"
        variant="default"
        isLoading={restoreMut.isPending}
        confirmDisabled={previewQuery.isFetching || previewQuery.isError || !preview?.can_restore}
        contentClassName="sm:max-w-lg"
      />

      <ActivityDetailSheet
        projectId={projectId}
        activityId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        onRestore={() => {
          if (detailId) {
            setRestoreTarget(detailId)
            setDetailId(null)
          }
        }}
      />
    </div>
  )
}
