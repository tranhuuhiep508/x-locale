import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { RotateCcw, RotateCw, Clock } from 'lucide-react'
import { activitiesApi } from '@/lib/api/activities'
import type { Activity } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { activitiesQuery } from '@/lib/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataPagination } from '@/components/ui/data-pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/lib/toast'
import { formatDate } from '@/lib/utils'
const routeApi = getRouteApi('/projects/$projectId/activity')


const ACTION_COLOR: Record<string, 'default' | 'secondary' | 'destructive'> = {
  create: 'default',
  update: 'secondary',
  delete: 'destructive',
  revert: 'secondary',
  redo: 'secondary',
}

function stackedRevertDepth(summary: string) {
  const prefix = /^(?:Reverted:\s+)+/.exec(summary)
  if (!prefix) return 0
  return prefix[0].match(/Reverted:/g)?.length ?? 0
}

function isRedoEntry(a: Activity) {
  if (a.batch_kind !== 'revert') return false
  if (a.summary.startsWith('Redid ')) return true
  const depth = stackedRevertDepth(a.summary)
  return depth > 0 && depth % 2 === 0
}

function isRevertEntry(a: Activity) {
  return a.batch_kind === 'revert' && !isRedoEntry(a)
}

function activityLabel(a: Activity) {
  if (isRedoEntry(a)) return 'redo'
  if (isRevertEntry(a)) return 'revert'
  return a.action
}

function feedActionLabel(a: Activity) {
  return isRevertEntry(a) ? 'Redo' : 'Revert'
}

const LEGACY_ACTION: Record<string, string> = {
  Created: 'create',
  Updated: 'update',
  Deleted: 'delete',
}

function displaySummary(summary: string) {
  const depth = stackedRevertDepth(summary)
  if (depth === 0) return summary
  const rest = summary.replace(/^(?:Reverted:\s+)+/, '')
  const parsed = /^(Created|Updated|Deleted) string '([^']+)'/.exec(rest)
  const verb = depth % 2 === 1 ? 'Reverted' : 'Redid'
  if (parsed) return `${verb} ${LEGACY_ACTION[parsed[1]]} of '${parsed[2]}'`
  return `${verb} ${rest}`
}

export function ActivityPage() {
  const { projectId } = routeApi.useParams()
  const rawSearch = routeApi.useSearch()
  const search = { page: rawSearch.page ?? 1, page_size: rawSearch.page_size ?? 20 }
  const navigate = useNavigate({ from: '/projects/$projectId/activity' })
  const qc = useQueryClient()
  const toast = useToast()
  const [revertTarget, setRevertTarget] = useState<Activity | null>(null)

  const { data, isLoading } = useQuery(activitiesQuery(projectId, search.page, search.page_size))

  const revertMut = useMutation({
    mutationFn: (activityId: string) =>
      activitiesApi.revert(projectId, activityId),
    onSuccess: () => {
      toast.success(revertTarget && isRevertEntry(revertTarget) ? 'Redone successfully' : 'Reverted successfully')
      qc.invalidateQueries({ queryKey: queryKeys.projects.activities.all(projectId) })
      qc.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
      setRevertTarget(null)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Revert failed'),
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / search.page_size)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b bg-background px-4 py-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <Clock className="size-5 text-primary" />
          Activity feed
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="No activity yet" description="Changes will appear here." />
        ) : (
          <div className="flex flex-col gap-1 px-2 py-2">
            {items.map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-3 rounded-lg px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <div className="mt-0.5 shrink-0">
                  <Badge variant={ACTION_COLOR[activityLabel(a)] ?? 'default'}>
                    {activityLabel(a)}
                  </Badge>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{displaySummary(a.summary)}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{a.actor_label}</span>
                    <span>·</span>
                    <span>{formatDate(a.created_at)}</span>
                    {a.locale ? (
                      <>
                        <span>·</span>
                        <code>{a.locale}</code>
                      </>
                    ) : null}
                  </div>
                  <ActivityFieldDiffs activity={a} />
                </div>
                {a.is_revertible && !a.reverted_by_id ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-muted-foreground hover:text-primary"
                    onClick={() => setRevertTarget(a)}
                  >
                    {isRevertEntry(a) ? (
                      <RotateCw data-icon="inline-start" />
                    ) : (
                      <RotateCcw data-icon="inline-start" />
                    )}
                    {feedActionLabel(a)}
                  </Button>
                ) : null}
                {a.reverted_by_id ? (
                  <span className="shrink-0 text-xs text-muted-foreground italic">reverted</span>
                ) : null}
              </div>
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
        open={revertTarget !== null}
        onClose={() => setRevertTarget(null)}
        onConfirm={() => revertTarget && revertMut.mutate(revertTarget.id)}
        title={
          revertTarget && isRevertEntry(revertTarget)
            ? 'Redo this change?'
            : 'Revert this change?'
        }
        description={
          revertTarget && isRevertEntry(revertTarget)
            ? 'This will redo the original change. A new activity will be logged.'
            : 'This will revert the recorded change. A new activity will be logged.'
        }
        confirmLabel={revertTarget ? feedActionLabel(revertTarget) : 'Revert'}
        variant="default"
        isLoading={revertMut.isPending}
      />
    </div>
  )
}

const FIELD_LABELS: Record<string, string> = {
  key: 'Key',
  source_text: 'Source text',
  description: 'Description',
  status: 'Status',
  module_id: 'Module',
  published_key: 'Published key',
  published_source_text: 'Published source',
  pending_delete: 'Pending delete',
  deleted_at: 'Deleted at',
  tags: 'Tags',
}

function formatSnapshotValue(value: unknown): string {
  if (value == null || value === '') return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : '—'
  return String(value)
}

function flattenSnapshot(snap: Record<string, unknown> | null): Record<string, string> {
  if (!snap) return {}
  const out: Record<string, string> = {}
  for (const key of [
    'key',
    'source_text',
    'description',
    'status',
    'module_id',
    'published_key',
    'published_source_text',
    'pending_delete',
    'deleted_at',
  ] as const) {
    if (key in snap) out[key] = formatSnapshotValue(snap[key])
  }
  if ('tag_ids' in snap) out.tags = formatSnapshotValue(snap.tag_ids)
  const trans = snap.translations
  if (trans && typeof trans === 'object' && !Array.isArray(trans)) {
    for (const [locale, value] of Object.entries(trans as Record<string, unknown>)) {
      out[`locale:${locale}`] = formatSnapshotValue(value)
    }
  } else if (Array.isArray(trans)) {
    for (const item of trans) {
      if (item && typeof item === 'object' && 'locale' in item) {
        const row = item as { locale: string; value?: unknown }
        out[`locale:${row.locale}`] = formatSnapshotValue(row.value)
      }
    }
  }
  return out
}

function fieldLabel(key: string): string {
  if (key.startsWith('locale:')) return key.slice('locale:'.length)
  return FIELD_LABELS[key] ?? key
}

function ActivityFieldDiffs({ activity }: { activity: Activity }) {
  const before = flattenSnapshot(activity.before)
  const after = flattenSnapshot(activity.after)
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  const rows = keys.flatMap((key) => {
    const from = before[key]
    const to = after[key]
    if (activity.action === 'update' && from === to) return []
    if (activity.action === 'create' && (to == null || to === '—')) return []
    return [{ key, from, to }]
  })
  if (rows.length === 0) return null

  return (
    <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
      {rows.map((row) => (
        <div key={row.key} className="flex min-w-0 gap-2">
          <span className="shrink-0 font-medium text-foreground/80">{fieldLabel(row.key)}</span>
          {activity.action === 'create' ? (
            <span className="min-w-0 truncate">{row.to}</span>
          ) : activity.action === 'delete' ? (
            <span className="min-w-0 truncate">{row.from}</span>
          ) : (
            <span className="min-w-0 truncate">
              {row.from} → {row.to}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
