import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Pencil, Trash2, Tags as TagsIcon } from 'lucide-react'
import { api } from '../../../lib/api/client'
import type { Tag } from '../../../lib/api/types'
import { queryKeys } from '../../../lib/query-keys'
import { tagCreateSchema } from '../../../lib/schemas'
import type { TagCreateForm } from '../../../lib/schemas'
import {
  Button,
  Input,
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

export const Route = createFileRoute('/projects/$projectId/tags')({
  component: TagsPage,
})

const PRESET_COLORS = [
  '#64748b',
  '#0d9488',
  '#2563eb',
  '#9333ea',
  '#e11d48',
  '#f59e0b',
  '#10b981',
  '#f97316',
]

type FormErrors = Partial<Record<keyof TagCreateForm, string>>

function TagsPage() {
  const { projectId } = Route.useParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: tags = [], isLoading } = useQuery<Tag[]>({
    queryKey: queryKeys.tags(projectId),
    queryFn: () => api.get<Tag[]>(`/projects/${projectId}/tags`),
  })

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<Tag | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
  const [form, setForm] = useState<TagCreateForm>({ name: '', color: '#64748b' })
  const [errors, setErrors] = useState<FormErrors>({})

  function resetForm() {
    setForm({ name: '', color: '#64748b' })
    setErrors({})
  }

  const createMut = useMutation({
    mutationFn: (data: TagCreateForm) =>
      api.post<Tag>(`/projects/${projectId}/tags`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tags(projectId) })
      toast.success('Tag created')
      setShowCreate(false)
      resetForm()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create tag'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<TagCreateForm> }) =>
      api.patch<Tag>(`/projects/${projectId}/tags/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tags(projectId) })
      toast.success('Tag updated')
      setEditTarget(null)
      resetForm()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to update tag'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/tags/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.tags(projectId) })
      toast.success('Tag deleted')
      setDeleteTarget(null)
    },
    onError: () => toast.error('Failed to delete tag'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const result = tagCreateSchema.safeParse(form)
    if (!result.success) {
      const errs: FormErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof TagCreateForm
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
        <h1 className="text-xl font-semibold text-slate-900">Tags</h1>
        <Button size="sm" onClick={() => { resetForm(); setShowCreate(true) }}>
          <Plus className="h-4 w-4" />
          New tag
        </Button>
      </div>

      {isLoading ? null : tags.length === 0 ? (
        <EmptyState
          icon={<TagsIcon className="h-10 w-10" />}
          title="No tags yet"
          description="Tags help categorize and filter strings."
          action={
            <Button onClick={() => { resetForm(); setShowCreate(true) }}>
              <Plus className="h-4 w-4" />
              Create tag
            </Button>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tag</TableHead>
              <TableHead>Strings</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <span
                    className="flex items-center gap-2 px-2.5 py-0.5 rounded-full text-sm font-medium w-fit"
                    style={{ backgroundColor: t.color + '22', color: t.color }}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.color }} />
                    {t.name}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="default">{t.string_count}</Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setEditTarget(t)
                        setForm({ name: t.name, color: t.color })
                        setErrors({})
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-slate-400 hover:text-red-500"
                      onClick={() => setDeleteTarget(t)}
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

      <Dialog
        open={showCreate || editTarget !== null}
        onClose={() => { setShowCreate(false); setEditTarget(null); resetForm() }}
        title={editTarget ? 'Edit tag' : 'New tag'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField>
            <Label>Name</Label>
            <Input
              placeholder="ios"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              error={errors.name}
            />
            <FormError message={errors.name} />
          </FormField>
          <FormField>
            <Label>Color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                className="h-9 w-9 rounded border border-slate-300 p-0.5 cursor-pointer"
              />
              <div className="flex flex-wrap gap-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: form.color === c ? '#0d9488' : 'transparent',
                    }}
                  />
                ))}
              </div>
            </div>
            <div
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-sm font-medium w-fit mt-1"
              style={{ backgroundColor: form.color + '22', color: form.color }}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: form.color }} />
              {form.name || 'Preview'}
            </div>
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
        title={`Delete tag "${deleteTarget?.name}"?`}
        description="The tag will be removed from all strings."
        confirmLabel="Delete tag"
        isLoading={deleteMut.isPending}
      />
    </div>
  )
}
