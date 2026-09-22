import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { activitiesApi } from '@/lib/api/activities'
import type { ActivityChange, ActivityFeedCard, RevertPreview } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { activityFeedQuery, batchRevertPreviewQuery, projectQuery } from '@/lib/queries'
import { ActivityCard } from '@/features/activity/ActivityCard'
import { ActivityDetailSheet } from '@/features/activity/ActivityDetailSheet'
import { changeDisplayValue, changeFieldLabel } from '@/features/activity/change-labels'
import { EVENT_TYPE_FILTER_OPTIONS } from '@/features/activity/event-type-labels'
import {
  isUndoConflict,
  outcomeLabel,
  previewConflictsShowingCaption,
  previewItemsShowingCaption,
  previewTruncated,
  undoDescription,
  undoOverwriteDescription,
} from '@/features/activity/undo-batch'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataPagination } from '@/components/ui/data-pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { PageHeader } from '@/components/layout/PageHeader'
import { useToast } from '@/lib/toast'
import type { ActivitySearch } from '@/lib/schemas'
import { dayHeading, dayKey } from '@/lib/utils'

const routeApi = getRouteApi('/projects/$projectId/activity')

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
      {preview.conflict_count > 0 ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
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
          {conflictsCaption ? (
            <p className="mt-1 text-destructive/80">{conflictsCaption}</p>
          ) : null}
        </div>
      ) : null}
      <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto rounded-md border p-2">
        {visible.map((item) => (
          <li key={item.activity_id} className="text-xs text-muted-foreground">
            <div className="flex flex-wrap items-baseline gap-1">
              <span className="font-mono text-foreground/80">{item.string_key ?? 'string'}</span>
              <span>{outcomeLabel(item)}</span>
            </div>
            {item.changes.map((change) => (
              <p key={changeKey(change)} className="truncate">
                <span className="font-medium text-foreground/70">{changeFieldLabel(change)}</span>{' '}
                “{changeDisplayValue(change, change.before)}” → “{changeDisplayValue(change, change.after)}”
              </p>
            ))}
            {previewTruncated(item.changes.length, item.change_count) ? (
              <p className="text-muted-foreground/80">…</p>
            ) : null}
          </li>
        ))}
        {previewTruncated(visible.length, preview.total) ? (
          <li className="text-xs text-muted-foreground/80">…</li>
        ) : null}
      </ul>
      {itemsCaption ? <p className="text-xs text-muted-foreground">{itemsCaption}</p> : null}
    </div>
  )
}

export function ActivityPage() {
  const { projectId } = routeApi.useParams()
  const rawSearch = routeApi.useSearch()
  const search = {
    page: rawSearch.page ?? 1,
    page_size: rawSearch.page_size ?? 20,
    event_type: rawSearch.event_type,
    actor: rawSearch.actor,
    locale: rawSearch.locale,
    since: rawSearch.since,
    until: rawSearch.until,
  }
  const navigate = useNavigate({ from: '/projects/$projectId/activity' })
  const qc = useQueryClient()
  const toast = useToast()
  const [undoTarget, setUndoTarget] = useState<ActivityFeedCard | null>(null)
  const [undoOverwrite, setUndoOverwrite] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const { data: project } = useQuery(projectQuery(projectId))
  const { data, isLoading } = useQuery(
    activityFeedQuery(projectId, {
      page: search.page,
      page_size: search.page_size,
      event_type: search.event_type,
      actor: search.actor,
      locale: search.locale,
      since: search.since,
      until: search.until,
    }),
  )

  const undoPreviewQuery = useQuery({
    ...batchRevertPreviewQuery(projectId, undoTarget?.batch_id ?? ''),
    enabled: undoTarget !== null && Boolean(undoTarget.batch_id),
  })
  const undoPreview = undoPreviewQuery.data

  // Surface conflicts as soon as the preview loads, instead of waiting for a 409
  // from the actual revert attempt.
  useEffect(() => {
    if (undoPreview?.requires_force) {
      setUndoOverwrite(true)
    }
  }, [undoPreview])

  function closeUndo() {
    setUndoTarget(null)
    setUndoOverwrite(false)
  }

  const undoMut = useMutation({
    mutationFn: ({ batchId, force }: { batchId: string; force: boolean }) =>
      activitiesApi.revertBatch(projectId, batchId, force),
    onSuccess: (result) => {
      toast.success(`Restored ${result.reverted} strings`)
      qc.invalidateQueries({ queryKey: queryKeys.projects.activities.all(projectId) })
      qc.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
      closeUndo()
    },
    onError: (e) => {
      if (isUndoConflict(e) && !undoOverwrite) {
        setUndoOverwrite(true)
        return
      }
      toast.error(e instanceof Error ? e.message : 'Undo failed')
    },
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / search.page_size)
  const locales = [project?.base_language, ...(project?.target_languages ?? [])].filter(
    (code, index, all): code is string => Boolean(code) && all.indexOf(code) === index,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-5 py-5">
        <PageHeader
          eyebrow="Project"
          title="Activity"
          description="What happened in this catalog, grouped by day."
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select
            value={search.event_type || 'all'}
            onValueChange={(value) =>
              setSearch({ event_type: value === 'all' ? undefined : value })
            }
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {EVENT_TYPE_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            className="w-40"
            placeholder="Person"
            defaultValue={search.actor ?? ''}
            onBlur={(event) =>
              setSearch({ actor: event.target.value.trim() || undefined })
            }
          />
          <Select
            value={search.locale || 'all'}
            onValueChange={(value) =>
              setSearch({ locale: value === 'all' ? undefined : value })
            }
          >
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Locale" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All locales</SelectItem>
                {locales.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <DateRangePicker
            value={{ since: search.since, until: search.until }}
            onChange={({ since, until }) => setSearch({ since, until })}
            placeholder="Date range"
            disabled={{ after: new Date() }}
          />
          {search.event_type || search.actor || search.locale || search.since || search.until ? (
            <Button variant="ghost" size="sm" onClick={() => navigate({ search: { page: 1 } })}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-2">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Clock />}
            title="No activity yet"
            description="Import Excel, edit a string, or publish a batch to see it here."
          />
        ) : (
          <div className="flex flex-col gap-5 px-2 py-4">
            {grouped.map((group) => (
              <section key={group.key} className="flex flex-col gap-1">
                <h2 className="px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.heading}
                </h2>
                {group.cards.map((card) => (
                  <ActivityCard
                    key={card.id}
                    card={card}
                    projectId={projectId}
                    onUndo={setUndoTarget}
                    onOpenDetail={setDetailId}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 ? (
        <div className="shrink-0 border-t px-4">
          <DataPagination
            page={search.page}
            pageSize={search.page_size}
            total={total}
            onPageChange={(p) => navigate({ search: (prev) => ({ ...prev, page: p }) })}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={undoTarget !== null}
        onClose={closeUndo}
        onConfirm={() =>
          undoTarget?.batch_id &&
          undoMut.mutate({
            batchId: undoTarget.batch_id,
            force: undoOverwrite || Boolean(undoPreview?.requires_force),
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
            <UndoPreviewList preview={undoPreview} />
          </div>
        }
        confirmLabel={undoOverwrite ? 'Overwrite and undo' : 'Undo'}
        variant={undoOverwrite ? 'destructive' : 'default'}
        isLoading={undoMut.isPending}
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
