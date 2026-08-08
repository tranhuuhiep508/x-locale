import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, lazy, Suspense } from 'react'
import { RotateCcw, Clock } from 'lucide-react'
import { api } from '../../../lib/api/client'
import type { ActivityListResponse } from '../../../lib/api/types'
import { queryKeys } from '../../../lib/query-keys'
import { activitySearchSchema } from '../../../lib/schemas'
import {
  Badge,
  Button,
  DataPagination,
  EmptyState,
  Spinner,
  ConfirmDialog,
} from '../../../components/ui'
import { useToast } from '../../../store'
import { formatDate } from '../../../lib/utils'
import { useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/projects/$projectId/activity')({
  validateSearch: (s: Record<string, unknown>) => activitySearchSchema.parse(s),
  component: ActivityPage,
})

function ActivityPage() {
  const { projectId } = Route.useParams()
  const rawSearch = Route.useSearch()
  const search = { page: rawSearch.page ?? 1, page_size: rawSearch.page_size ?? 20 }
  const navigate = useNavigate({ from: Route.fullPath })
  const qc = useQueryClient()
  const toast = useToast()
  const [revertTarget, setRevertTarget] = useState<string | null>(null)

  const { data, isLoading } = useQuery<ActivityListResponse>({
    queryKey: queryKeys.activities(projectId, search.page),
    queryFn: () =>
      api.get<ActivityListResponse>(`/projects/${projectId}/activities`, {
        page: search.page,
        page_size: search.page_size,
      }),
  })

  const revertMut = useMutation({
    mutationFn: (activityId: string) =>
      api.post(`/projects/${projectId}/activities/${activityId}/revert`),
    onSuccess: () => {
      toast.success('Reverted successfully')
      qc.invalidateQueries({ queryKey: queryKeys.activities(projectId, search.page) })
      setRevertTarget(null)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Revert failed'),
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0

  const actionColor: Record<string, 'default' | 'secondary' | 'destructive'> = {
    create: 'default',
    update: 'secondary',
    delete: 'destructive',
  }

  return (
    <div className="container py-6">
      <h1 className="text-xl font-semibold text-foreground mb-6 flex items-center gap-2">
        <Clock className="h-5 w-5 text-primary" />
        Activity feed
      </h1>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No activity yet" description="Changes will appear here." />
      ) : (
        <div className="flex flex-col gap-1">
          {items.map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-3 py-3 px-4 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <div className="mt-0.5 shrink-0">
                <Badge variant={actionColor[a.action] ?? 'default'}>
                  {a.action}
                </Badge>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">{a.summary}</p>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <span>{a.actor_label}</span>
                  <span>·</span>
                  <span>{formatDate(a.created_at)}</span>
                  {a.locale && (
                    <>
                      <span>·</span>
                      <code>{a.locale}</code>
                    </>
                  )}
                </div>
              </div>
              {a.is_revertible && !a.reverted_by_id && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-primary shrink-0"
                  onClick={() => setRevertTarget(a.id)}
                >
                  <RotateCcw data-icon="inline-start" />
                  Revert
                </Button>
              )}
              {a.reverted_by_id && (
                <span className="text-xs text-muted-foreground shrink-0 italic">reverted</span>
              )}
            </div>
          ))}
        </div>
      )}

      <DataPagination
        page={search.page}
        pageSize={search.page_size}
        total={total}
        onPageChange={(p) => navigate({ search: (prev) => ({ ...prev, page: p }) })}
      />

      <ConfirmDialog
        open={revertTarget !== null}
        onClose={() => setRevertTarget(null)}
        onConfirm={() => revertTarget && revertMut.mutate(revertTarget)}
        title="Revert this change?"
        description="This will undo the recorded action. The undo itself will appear in the activity log."
        confirmLabel="Revert"
        variant="default"
        isLoading={revertMut.isPending}
      />
    </div>
  )
}
