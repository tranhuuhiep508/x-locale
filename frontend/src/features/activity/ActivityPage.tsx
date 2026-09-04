import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { activitiesApi } from '@/lib/api/activities'
import type { ActivityFeedCard } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { activityFeedQuery, projectQuery } from '@/lib/queries'
import { ActivityCard } from '@/features/activity/ActivityCard'
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

function undoDescription(card: ActivityFeedCard): string {
  const created = card.counts.created ?? 0
  if (created > 0) {
    const noun = created === 1 ? 'string' : 'strings'
    return (
      `This undoes ${card.children_count} strings. ${created} new ${noun} will be moved to Deleted ` +
      '(or queued for public removal if already published). Later edits to those strings will be overwritten.'
    )
  }
  return `This restores ${card.children_count} strings to their values before this action. Later edits to those strings will be overwritten.`
}

const EVENT_FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'All types' },
  { value: 'string.created', label: 'Created' },
  { value: 'translation.updated', label: 'Translations' },
  { value: 'string.published', label: 'Published' },
  { value: 'import', label: 'Imports' },
  { value: 'translate', label: 'AI translate' },
  { value: 'batch', label: 'Batch actions' },
  { value: 'string.restored', label: 'Restored' },
]

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

  const undoMut = useMutation({
    mutationFn: (batchId: string) => activitiesApi.revertBatch(projectId, batchId),
    onSuccess: (result) => {
      toast.success(`Restored ${result.reverted} strings`)
      qc.invalidateQueries({ queryKey: queryKeys.projects.activities.all(projectId) })
      qc.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
      setUndoTarget(null)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Undo failed'),
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
                {EVENT_FILTERS.map((option) => (
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
        onClose={() => setUndoTarget(null)}
        onConfirm={() => undoTarget?.batch_id && undoMut.mutate(undoTarget.batch_id)}
        title="Undo this batch?"
        description={undoTarget ? undoDescription(undoTarget) : ''}
        confirmLabel="Undo"
        variant="default"
        isLoading={undoMut.isPending}
      />
    </div>
  )
}
