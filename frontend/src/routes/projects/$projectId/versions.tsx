import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, RotateCcw, Trash2, Camera } from 'lucide-react'
import { api } from '@/lib/api/client'
import type { SnapshotListResponse, Snapshot } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { snapshotCreateSchema } from '@/lib/schemas'
import type { SnapshotCreateForm } from '@/lib/schemas'
import {
  Button,
  Input,
  Textarea,
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  ConfirmDialog,
  EmptyState,
  Badge,
  Card,
  CardContent,
  Spinner,
} from '@/components/ui'
import { useToast } from '@/store'
import { formatDate } from '@/lib/utils'

export const Route = createFileRoute('/projects/$projectId/versions')({
  component: VersionsPage,
})

type FormErrors = Partial<Record<keyof SnapshotCreateForm, string>>

function VersionsPage() {
  const { projectId } = Route.useParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data, isLoading } = useQuery<SnapshotListResponse>({
    queryKey: queryKeys.snapshots(projectId),
    queryFn: () => api.get<SnapshotListResponse>(`/projects/${projectId}/snapshots`),
  })

  const [showCreate, setShowCreate] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<Snapshot | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Snapshot | null>(null)
  const [form, setForm] = useState<SnapshotCreateForm>({ name: '', description: '' })
  const [errors, setErrors] = useState<FormErrors>({})

  function resetForm() {
    setForm({ name: '', description: '' })
    setErrors({})
  }

  const createMut = useMutation({
    mutationFn: (data: SnapshotCreateForm) =>
      api.post<Snapshot>(`/projects/${projectId}/snapshots`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.snapshots(projectId) })
      toast.success('Snapshot created')
      setShowCreate(false)
      resetForm()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create snapshot'),
  })

  const restoreMut = useMutation({
    mutationFn: (id: string) =>
      api.post(`/projects/${projectId}/snapshots/${id}/restore`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.project(projectId) })
      qc.invalidateQueries({ queryKey: queryKeys.strings(projectId, {}) })
      toast.success('Snapshot restored')
      setRestoreTarget(null)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Restore failed'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/snapshots/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.snapshots(projectId) })
      toast.success('Snapshot deleted')
      setDeleteTarget(null)
    },
    onError: () => toast.error('Failed to delete snapshot'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = snapshotCreateSchema.safeParse(form)
    if (!result.success) {
      const errs: FormErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof SnapshotCreateForm
        if (!errs[key]) errs[key] = issue.message
      }
      setErrors(errs)
      return
    }
    setErrors({})
    createMut.mutate(result.data)
  }

  const snapshots = data?.items ?? []

  return (
    <div className="container py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-foreground flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" />
          Snapshots
        </h1>
        <Button size="sm" onClick={() => { resetForm(); setShowCreate(true) }}>
          <Plus data-icon="inline-start" />
          Take snapshot
        </Button>
      </div>

      {isLoading ? null : snapshots.length === 0 ? (
        <EmptyState
          icon={<Camera className="h-10 w-10" />}
          title="No snapshots yet"
          description="Snapshots let you save and restore the state of all translations."
          action={
            <Button onClick={() => { resetForm(); setShowCreate(true) }}>
              <Plus data-icon="inline-start" />
              Take snapshot
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {snapshots.map((s) => (
            <Card key={s.id}>
              <CardContent>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-foreground">{s.name}</h3>
                      <Badge
                        variant={s.kind === 'auto' ? 'secondary' : 'default'}
                        className="text-[10px]"
                      >
                        {s.kind}
                      </Badge>
                    </div>
                    {s.description && (
                      <p className="text-sm text-muted-foreground mb-2">{s.description}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{s.string_count} strings</span>
                      <span>·</span>
                      <span>{formatDate(s.created_at)}</span>
                      <span>·</span>
                      <code className="font-mono">{s.content_hash.slice(0, 8)}</code>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRestoreTarget(s)}
                    >
                      <RotateCcw data-icon="inline-start" />
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(s)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={showCreate}
        onOpenChange={(o) => {
          if (!o) {
            setShowCreate(false)
            resetForm()
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Take snapshot</DialogTitle>
            <DialogDescription>
              Capture the current state of all translations.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field data-invalid={errors.name ? 'true' : undefined}>
                <FieldLabel htmlFor="snapshot_name">Name</FieldLabel>
                <Input
                  id="snapshot_name"
                  placeholder="v1.2.0 release"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  aria-invalid={errors.name ? true : undefined}
                />
                <FieldError>{errors.name}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="snapshot_description">Description (optional)</FieldLabel>
                <Textarea
                  id="snapshot_description"
                  placeholder="Pre-release snapshot"
                  value={form.description ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </Field>
              <DialogFooter className="mt-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => { setShowCreate(false); resetForm() }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createMut.isPending}>
                  {createMut.isPending && <Spinner data-icon="inline-start" />}
                  Take snapshot
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => restoreTarget && restoreMut.mutate(restoreTarget.id)}
        title={`Restore "${restoreTarget?.name}"?`}
        description="This will overwrite all current translations with the snapshot content. A snapshot of the current state will be saved first."
        confirmLabel="Restore"
        variant="default"
        isLoading={restoreMut.isPending}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This snapshot will be permanently deleted."
        confirmLabel="Delete"
        isLoading={deleteMut.isPending}
      />
    </div>
  )
}
