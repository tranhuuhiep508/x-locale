import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Pencil, Trash2, Boxes } from 'lucide-react'
import { api } from '../../../lib/api/client'
import type { Module } from '../../../lib/api/types'
import { queryKeys } from '../../../lib/query-keys'
import { moduleCreateSchema } from '../../../lib/schemas'
import type { ModuleCreateForm } from '../../../lib/schemas'
import {
  Button,
  Input,
  Textarea,
  Label,
  FormField,
  FormError,
  Dialog,
  DialogFooter,
  ConfirmDialog,
  EmptyState,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
} from '../../../components/ui'
import { useToast } from '../../../store'

export const Route = createFileRoute('/projects/$projectId/modules')({
  component: ModulesPage,
})

type FormErrors = Partial<Record<keyof ModuleCreateForm, string>>

function ModulesPage() {
  const { projectId } = Route.useParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: modules = [], isLoading } = useQuery<Module[]>({
    queryKey: queryKeys.modules(projectId),
    queryFn: () => api.get<Module[]>(`/projects/${projectId}/modules`),
  })

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<Module | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Module | null>(null)
  const [form, setForm] = useState<ModuleCreateForm>({ slug: '', name: '', description: '' })
  const [errors, setErrors] = useState<FormErrors>({})

  function resetForm() {
    setForm({ slug: '', name: '', description: '' })
    setErrors({})
  }

  const createMut = useMutation({
    mutationFn: (data: ModuleCreateForm) =>
      api.post<Module>(`/projects/${projectId}/modules`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.modules(projectId) })
      toast.success('Module created')
      setShowCreate(false)
      resetForm()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create module'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ModuleCreateForm> }) =>
      api.patch<Module>(`/projects/${projectId}/modules/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.modules(projectId) })
      toast.success('Module updated')
      setEditTarget(null)
      resetForm()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to update module'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/modules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.modules(projectId) })
      toast.success('Module deleted')
      setDeleteTarget(null)
    },
    onError: () => toast.error('Failed to delete module'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = moduleCreateSchema.safeParse(form)
    if (!result.success) {
      const errs: FormErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof ModuleCreateForm
        if (!errs[key]) errs[key] = issue.message
      }
      setErrors(errs)
      return
    }
    setErrors({})
    if (editTarget) {
      updateMut.mutate({ id: editTarget.id, data: result.data })
    } else {
      createMut.mutate(result.data)
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Modules</h1>
        <Button size="sm" onClick={() => { resetForm(); setShowCreate(true) }}>
          <Plus className="h-4 w-4" />
          New module
        </Button>
      </div>

      {isLoading ? null : modules.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-10 w-10" />}
          title="No modules yet"
          description="Modules group related strings together."
          action={
            <Button onClick={() => { resetForm(); setShowCreate(true) }}>
              <Plus className="h-4 w-4" />
              Create module
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Strings</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {modules.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <code className="text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                    {m.slug}
                  </code>
                </TableCell>
                <TableCell className="font-medium">{m.name}</TableCell>
                <TableCell className="text-slate-500 text-sm max-w-xs truncate">
                  {m.description ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge variant="default">{m.string_count}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditTarget(m)
                        setForm({ slug: m.slug, name: m.name, description: m.description ?? '' })
                        setErrors({})
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-slate-400 hover:text-red-500"
                      onClick={() => setDeleteTarget(m)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create / Edit dialog */}
      <Dialog
        open={showCreate || editTarget !== null}
        onClose={() => { setShowCreate(false); setEditTarget(null); resetForm() }}
        title={editTarget ? 'Edit module' : 'New module'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField>
            <Label>Slug</Label>
            <Input
              className="font-mono"
              placeholder="common"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              error={errors.slug}
              disabled={!!editTarget}
            />
            <FormError message={errors.slug} />
          </FormField>
          <FormField>
            <Label>Name</Label>
            <Input
              placeholder="Common strings"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              error={errors.name}
            />
            <FormError message={errors.name} />
          </FormField>
          <FormField>
            <Label>Description (optional)</Label>
            <Textarea
              placeholder="Shared UI strings used across pages"
              value={form.description ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </FormField>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => { setShowCreate(false); setEditTarget(null); resetForm() }}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMut.isPending || updateMut.isPending}>
              {editTarget ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="Strings in this module will become unassigned."
        confirmLabel="Delete module"
        isLoading={deleteMut.isPending}
      />
    </div>
  )
}
