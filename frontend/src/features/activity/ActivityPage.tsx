import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { CalendarDays, Clock, HelpCircle, History, RotateCcw, ShieldAlert } from 'lucide-react'
import { activitiesApi } from '@/lib/api/activities'
import { ApiError } from '@/lib/api/client'
import { claimFinish, jobSuccessMessage, refreshProjectContent, rememberJob } from '@/lib/active-job'
import { isJobAccepted } from '@/lib/api/jobs'
import type {
  ActivityChange,
  ActivityFeedCard,
  BatchRevertResult,
  RevertPreview,
} from '@/lib/api/types'
import { useJob } from '@/hooks/use-job'
import { JobProgress } from '@/components/job-progress'
import { undoProgressLabel } from '@/lib/job-progress'
import { queryKeys } from '@/lib/query-keys'
import { activityFeedQuery, batchRevertPreviewQuery, projectQuery } from '@/lib/queries'
import { ActivityCard, activityVisualMeta } from '@/features/activity/ActivityCard'
import { ActivityDetailSheet } from '@/features/activity/ActivityDetailSheet'
import { PreviewFailure } from '@/features/activity/PreviewFailure'
import { changeDisplayValue, changeFieldLabel } from '@/features/activity/change-labels'
import { ActivityFilters, hasActivityFilters } from '@/features/activity/ActivityFilters'
import {
  outcomeLabel,
  previewConflictsShowingCaption,
  previewItemsShowingCaption,
  previewTruncated,
  undoDescription,
  undoOverwriteDescription,
} from '@/features/activity/undo-batch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataPagination } from '@/components/ui/data-pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/layout/PageHeader'
import { publicationErrorMessage } from '@/features/strings/publish-preview'
import { useToast } from '@/lib/toast'
import type { ActivitySearch } from '@/lib/schemas'
import { cn, dayHeading, dayKey } from '@/lib/utils'

const routeApi = getRouteApi('/projects/$projectRef/activity')

const LEDGER_RULES = [
  {
    tour: 'batch-undo',
    icon: RotateCcw,
    text: 'Undo a whole import, translation, or batch from the list.',
  },
  {
    tour: 'string-history',
    icon: History,
    text: 'Restore one string from its History.',
  },
  {
    tour: 'restore-limits',
    icon: ShieldAlert,
    text: 'Publish, unpublish, and deletes are not in History.',
  },
] as const

function changeKey(change: ActivityChange) {
  return `${change.scope}:${change.field}:${change.locale ?? ''}:${change.before}:${change.after}`
}

function UndoPreviewList({ preview }: { preview: RevertPreview | undefined }) {
  if (!preview) {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Loading preview…
      </span>
    )
  }

  const conflicts = preview.conflicts
  const visible = preview.items
  const itemsCaption = previewItemsShowingCaption(preview)
  const conflictsCaption = previewConflictsShowingCaption(preview)

  return (
    <div className="flex flex-col gap-2 text-left">
      {preview.blocked_reason ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive"
        >
          {preview.blocked_reason}
        </p>
      ) : null}
      {preview.conflict_count > 0 ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          <p className="font-medium">
            {preview.conflict_count} {preview.conflict_count === 1 ? 'string was' : 'strings were'}{' '}
            edited since this action:
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {conflicts.map((item) => (
              <li key={item.activity_id} className="font-mono">
                {item.string_key ?? item.activity_id}
              </li>
            ))}
            {previewTruncated(conflicts.length, preview.conflict_count) ? (
              <li className="font-mono text-destructive/80">…</li>
            ) : null}
          </ul>
          {conflictsCaption ? <p className="mt-1 text-destructive/80">{conflictsCaption}</p> : null}
        </div>
      ) : null}
      <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-md border border-border/80 bg-muted/20 p-2.5">
        {visible.map((item) => (
          <li key={item.activity_id} className="text-xs text-muted-foreground">
            <div className="flex flex-wrap items-baseline gap-1">
              <span className="font-mono text-foreground/85">{item.string_key ?? 'string'}</span>
              <span>{outcomeLabel(item)}</span>
            </div>
            {item.changes.map((change) => (
              <p key={changeKey(change)} className="truncate">
                <span className="font-medium text-foreground/75">
                  {changeFieldLabel(change)}
                  {change.scope === 'published' ? ' (published)' : ''}
                </span>{' '}
                “{changeDisplayValue(change, change.before)}” → “
                {changeDisplayValue(change, change.after)}”
              </p>
            ))}
            {item.blocked_reason ? <p className="text-destructive">{item.blocked_reason}</p> : null}
            {previewTruncated(item.changes.length, item.change_count) ? (
              <p className="text-muted-foreground">…</p>
            ) : null}
          </li>
        ))}
        {previewTruncated(visible.length, preview.total) ? (
          <li className="text-xs text-muted-foreground">…</li>
        ) : null}
      </ul>
      {itemsCaption ? <p className="text-xs text-muted-foreground">{itemsCaption}</p> : null}
    </div>
  )
}

function ActivitySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading activity">
      <div className="flex items-center gap-3">
        <Skeleton className="h-6 w-28 rounded-md" />
        <div className="h-px flex-1 bg-border/60" />
        <Skeleton className="h-4 w-16 rounded-md" />
      </div>
      <div className="flex flex-col gap-3 pl-9">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  )
}

export function ActivityPage() {
  const { projectRef: projectId } = routeApi.useParams()
  const rawSearch = routeApi.useSearch()
  const search = {
    page: rawSearch.page ?? 1,
    page_size: rawSearch.page_size ?? 20,
    event_type: rawSearch.event_type,
    actor: rawSearch.actor,
    locale: rawSearch.locale,
    period: rawSearch.period,
    since: rawSearch.since,
    until: rawSearch.until,
  }
  const navigate = useNavigate({ from: '/projects/$projectRef/activity' })
  const qc = useQueryClient()
  const toast = useToast()
  const [undoTarget, setUndoTarget] = useState<ActivityFeedCard | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [undoJobId, setUndoJobId] = useState<string | null>(null)

  const { data: project } = useQuery(projectQuery(projectId))
  const { data, isLoading, isError, isSuccess, refetch } = useQuery(
    activityFeedQuery(projectId, {
      page: search.page,
      page_size: search.page_size,
      event_type: search.event_type,
      actor: search.actor,
      locale: search.locale,
      period: search.period,
      since: search.since,
      until: search.until,
    })
  )

  const undoPreviewQuery = useQuery({
    ...batchRevertPreviewQuery(projectId, undoTarget?.batch_id ?? ''),
    enabled: undoTarget !== null && Boolean(undoTarget.batch_id),
  })
  const undoPreview = undoPreviewQuery.data

  const undoOverwrite =
    !undoPreviewQuery.isFetching &&
    !undoPreviewQuery.isError &&
    Boolean(undoPreview?.requires_force)

  function closeUndo() {
    setUndoTarget(null)
  }

  function undoSucceeded(result: BatchRevertResult) {
    toast.success(`Restored ${result.reverted} strings`)
    qc.invalidateQueries({ queryKey: queryKeys.projects.activities.all(projectId) })
    qc.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
    closeUndo()
  }

  function undoFailed(e: unknown) {
    if (e instanceof ApiError && e.status === 409) {
      void undoPreviewQuery.refetch()
    }
    toast.error(publicationErrorMessage(e, 'Undo failed'))
  }

  const undoMut = useMutation({
    mutationFn: ({ batchId, force }: { batchId: string; force: boolean }) =>
      activitiesApi.revertBatch(projectId, batchId, force),
    onSuccess: (result) => {
      if (isJobAccepted(result)) {
        rememberJob({ jobId: result.job_id, projectId, kind: 'revert' })
        setUndoJobId(result.job_id)
      } else undoSucceeded(result)
    },
    onError: undoFailed,
  })

  const undoJob = useJob(undoJobId, {
    onStopped: () => {
      setUndoJobId(null)
      if (undoTarget) void undoPreviewQuery.refetch()
    },
    onCompleted: (job) => {
      setUndoJobId(null)
      if (claimFinish(job.id)) {
        const result = job.result as unknown as BatchRevertResult
        toast.success(jobSuccessMessage('revert', { reverted: result.reverted }))
        refreshProjectContent(qc, projectId)
      }
      closeUndo()
    },
    onFailed: (error) => {
      setUndoJobId(null)
      if (error.status === 409) void undoPreviewQuery.refetch()
      if (undoJobId && !claimFinish(undoJobId)) return
      toast.error(publicationErrorMessage(error, 'Undo failed'))
    },
  })
  const undoBusy = undoMut.isPending || undoJobId !== null

  const items = useMemo(() => data?.items ?? [], [data?.items])
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / search.page_size)
  const filtered = hasActivityFilters(search)
  const locales = [project?.base_language, ...(project?.target_languages ?? [])].filter(
    (code, index, all): code is string => Boolean(code) && all.indexOf(code) === index
  )

  const grouped = useMemo(() => {
    const groups: { heading: string; key: string; cards: ActivityFeedCard[] }[] = []
    for (const card of items) {
      const key = dayKey(card.created_at)
      const last = groups[groups.length - 1]
      if (last && last.key === key) {
        last.cards.push(card)
      } else {
        groups.push({ heading: dayHeading(card.created_at), key, cards: [card] })
      }
    }
    return groups
  }, [items])

  function setSearch(updates: Partial<ActivitySearch>) {
    navigate({
      search: (prev) => ({ ...prev, ...updates, page: updates.page ?? 1 }),
    })
  }

  function clearFilters() {
    navigate({ search: { page: 1, page_size: search.page_size } })
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-tour-ready={isSuccess ? 'activity' : undefined}
    >
      <div className="galley-grid shrink-0 border-b border-border/80 bg-card/85 px-4 py-3 backdrop-blur-md sm:px-6 sm:py-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3">
          <PageHeader
            title="Activity"
            badge={
              <div className="flex items-center gap-1.5">
                {total > 0 ? (
                  <Badge variant="secondary" className="font-mono text-xs tabular-nums">
                    {total} {total === 1 ? 'event' : 'events'}
                  </Badge>
                ) : null}
                {filtered ? (
                  <Badge
                    variant="outline"
                    className="bg-accent font-mono text-2xs text-accent-foreground"
                  >
                    Filtered
                  </Badge>
                ) : null}
              </div>
            }
            actions={
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-tour="batch-undo"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <HelpCircle data-icon="inline-start" />
                    Undo rules
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-3">
                  <p className="eyebrow mb-2">
                    Undo &amp; history rules
                  </p>
                  <ul className="flex flex-col gap-2">
                    {LEDGER_RULES.map((rule) => {
                      const RuleIcon = rule.icon
                      return (
                        <li
                          key={rule.tour}
                          className="flex items-start gap-2 text-xs leading-snug text-muted-foreground"
                        >
                          <RuleIcon
                            aria-hidden="true"
                            className="mt-0.5 size-3.5 shrink-0 text-primary/80"
                          />
                          <span>{rule.text}</span>
                        </li>
                      )
                    })}
                  </ul>
                </PopoverContent>
              </Popover>
            }
          />

          <ActivityFilters
            search={search}
            locales={locales}
            onFilter={setSearch}
            onClear={clearFilters}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 py-5">
          {isLoading ? (
            <ActivitySkeleton />
          ) : isError ? (
            <EmptyState
              variant="dashed"
              className="py-12"
              title="Couldn’t load activity"
              description="Try loading the catalog changes again."
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  Retry
                </Button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState
              variant="dashed"
              className="py-12"
              icon={<Clock />}
              title={filtered ? 'No matching activity' : 'No activity yet'}
              description={
                filtered
                  ? 'Try another person, event type, language, or date range.'
                  : 'Import Excel, edit a string, or publish a batch to see it here.'
              }
              action={
                filtered ? (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div data-tour="activity-list" className="flex flex-col gap-7">
              {grouped.map((group, groupIndex) => (
                <section
                  key={group.key}
                  style={{ '--stagger': Math.min(groupIndex + 1, 8) } as React.CSSProperties}
                  className="animate-stage-in flex min-w-0 flex-col gap-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="eyebrow inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-card px-2.5 py-1 text-foreground shadow-2xs">
                      <CalendarDays aria-hidden="true" className="size-3 text-primary" />
                      {group.heading || 'Unknown date'}
                    </span>
                    <div className="h-px flex-1 bg-border/70" />
                    <span className="font-mono text-2xs text-muted-foreground tabular-nums">
                      {group.cards.length} {group.cards.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>

                  <div className="relative flex flex-col gap-3 pl-9 sm:pl-10">
                    <div
                      aria-hidden="true"
                      className="absolute top-4 bottom-4 left-[13.5px] w-px bg-border/80 sm:left-[15.5px]"
                    />
                    {group.cards.map((card) => {
                      const visual = activityVisualMeta(card)
                      const NodeIcon = visual.icon
                      return (
                        <div key={card.id} className="relative min-w-0">
                          <span
                            aria-hidden="true"
                            className={cn(
                              'absolute top-4 -left-9 flex size-7 items-center justify-center rounded-md border shadow-2xs ring-4 ring-background sm:-left-10 sm:size-8',
                              visual.nodeClass
                            )}
                          >
                            <NodeIcon className="size-3.5" />
                          </span>
                          <ActivityCard
                            card={card}
                            projectId={projectId}
                            onUndo={setUndoTarget}
                            onOpenDetail={setDetailId}
                          />
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {data && total > 0 ? (
        <div className="shrink-0 border-t border-border/80 bg-card/85 px-4 backdrop-blur-md sm:px-6">
          <div className="mx-auto w-full max-w-6xl">
            {totalPages > 1 ? (
              <DataPagination
                page={search.page}
                pageSize={search.page_size}
                total={total}
                onPageChange={(page) => setSearch({ page })}
              />
            ) : (
              <p className="py-3 font-mono text-xs text-muted-foreground tabular-nums">
                {total} {total === 1 ? 'event' : 'events'}
                {filtered ? ' matching your filters' : ''}
              </p>
            )}
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={undoTarget !== null}
        onClose={closeUndo}
        onConfirm={() =>
          undoTarget?.batch_id &&
          undoMut.mutate({
            batchId: undoTarget.batch_id,
            force: undoOverwrite,
          })
        }
        title={undoOverwrite ? 'Overwrite later edits?' : 'Undo this batch?'}
        description={
          <div className="flex flex-col gap-3 text-left">
            <p>
              {undoOverwrite
                ? undoOverwriteDescription(undoPreview)
                : undoTarget
                  ? undoDescription(undoTarget, undoPreview)
                  : ''}
            </p>
            {undoJobId ? (
              <JobProgress
                progress={undoJob.data?.progress}
                error={undoJob.isError ? undoJob.error : undefined}
                paused={undoJob.isPaused}
                label={undoProgressLabel(undoJob.data?.progress)}
              />
            ) : null}
            {undoPreviewQuery.isError ? (
              <PreviewFailure
                error={undoPreviewQuery.error}
                onRetry={() => {
                  void undoPreviewQuery.refetch()
                }}
              />
            ) : (
              <UndoPreviewList preview={undoPreviewQuery.isFetching ? undefined : undoPreview} />
            )}
          </div>
        }
        confirmLabel={undoOverwrite ? 'Overwrite and undo' : 'Undo'}
        variant={undoOverwrite ? 'destructive' : 'default'}
        isLoading={undoBusy && !undoJob.isError && !undoJob.isPaused}
        confirmDisabled={
          undoBusy ||
          undoPreviewQuery.isFetching ||
          undoPreviewQuery.isError ||
          !undoPreview?.can_revert
        }
        contentClassName="sm:max-w-lg"
      />

      <ActivityDetailSheet
        projectId={projectId}
        activityId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
      />
    </div>
  )
}
