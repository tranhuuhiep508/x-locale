import { getRouteApi } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  type PaginationState,
} from '@tanstack/react-table'
import { Plus, Boxes } from 'lucide-react'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { modulesApi } from '@/lib/api/catalog'
import type { Module } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { modulesQuery } from '@/lib/queries'
import { moduleCreateSchema } from '@/lib/schemas'
import type { ModuleCreateForm } from '@/lib/schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldGroup, FieldLabel, FieldError } from '@/components/ui/field'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/lib/toast'
import { moduleColumns } from '@/features/modules/modules-columns'
const routeApi = getRouteApi('/projects/$projectId/modules')


type FormErrors = Partial<Record<keyof ModuleCreateForm, string>>

export function ModulesPage() {
  const { projectId } = routeApi.useParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: modules = [], isLoading } = useQuery(modulesQuery(projectId))
  const data = useMemo(() => modules, [modules])
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

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
      modulesApi.create(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.modules(projectId) })
      toast.success('Module created')
      setShowCreate(false)
      resetForm()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create module'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ModuleCreateForm> }) =>
      modulesApi.update(projectId, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.modules(projectId) })
      toast.success('Module updated')
      setEditTarget(null)
      resetForm()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to update module'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => modulesApi.delete(projectId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.modules(projectId) })
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

  const table = useReactTable({
    data,
    columns: moduleColumns,
    state: { globalFilter, pagination },
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSorting: false,
    globalFilterFn: 'includesString',
    meta: {
      onEdit: (module: Module) => {
        setEditTarget(module)
        setForm({
          slug: module.slug,
          name: module.name,
          description: module.description ?? '',
        })
        setErrors({})
      },
      onDelete: setDeleteTarget,
    },
  })

  return (
    <div className="container py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-foreground">Modules</h1>
        <Button size="sm" onClick={() => { resetForm(); setShowCreate(true) }}>
          <Plus data-icon="inline-start" />
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
              <Plus data-icon="inline-start" />
              Create module
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <DataTableToolbar
            search={globalFilter}
            onSearchChange={setGlobalFilter}
            placeholder="Search modules…"
          />
          <DataTable table={table} />
          <DataTablePagination table={table} />
        </div>
      )}

      {/* Create / Edit dialog */}
      <Dialog
        open={showCreate || editTarget !== null}
        onOpenChange={(o) => {
          if (!o) {
            setShowCreate(false)
            setEditTarget(null)
            resetForm()
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit module' : 'New module'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field data-invalid={errors.slug ? 'true' : undefined}>
                <FieldLabel htmlFor="module_slug">Slug</FieldLabel>
                <Input
                  id="module_slug"
                  className="font-mono"
                  placeholder="common"
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  aria-invalid={errors.slug ? true : undefined}
                  disabled={!!editTarget}
                />
                <FieldError>{errors.slug}</FieldError>
              </Field>
              <Field data-invalid={errors.name ? 'true' : undefined}>
                <FieldLabel htmlFor="module_name">Name</FieldLabel>
                <Input
                  id="module_name"
                  placeholder="Common strings"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  aria-invalid={errors.name ? true : undefined}
                />
                <FieldError>{errors.name}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="module_description">Description (optional)</FieldLabel>
                <Textarea
                  id="module_description"
                  placeholder="Shared UI strings used across pages"
                  value={form.description ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </Field>
              <DialogFooter className="mt-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => { setShowCreate(false); setEditTarget(null); resetForm() }}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
                  {(createMut.isPending || updateMut.isPending) && (
                    <Spinner data-icon="inline-start" />
                  )}
                  {editTarget ? 'Save' : 'Create'}
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
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
