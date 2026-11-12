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
import { PageHeader } from '@/components/layout/PageHeader'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { modulesApi } from '@/lib/api/catalog'
import type { Module } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { modulesQuery } from '@/lib/queries'
import { moduleCreateSchema } from '@/lib/schemas'
import type { ModuleCreateForm } from '@/lib/schemas'
import { ModuleFormFields } from '@/features/catalog/ModuleFormFields'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  ReviewDialogBody,
  ReviewDialogContent,
  ReviewDialogFooter,
  ReviewDialogHeader,
} from '@/components/layout/ReviewDialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/lib/toast'
import { moduleColumns } from '@/features/modules/modules-columns'
const routeApi = getRouteApi('/projects/$projectRef/modules')

type FormErrors = Partial<Record<keyof ModuleCreateForm, string>>

export function ModulesPage() {
  const { projectRef: projectId } = routeApi.useParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: modules = [], isLoading } = useQuery(modulesQuery(projectId))
  const data = useMemo(() => modules, [modules])
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<Module | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Module | null>(null)
  const [form, setForm] = useState<ModuleCreateForm>({
    slug: '',
    name: '',
    description: '',
    translation_context: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})

  function resetForm() {
    setForm({ slug: '', name: '', description: '', translation_context: '' })
    setErrors({})
  }

  const createMut = useMutation({
    mutationFn: (data: ModuleCreateForm) => modulesApi.create(projectId, data),
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
          translation_context: module.translation_context ?? '',
        })
        setErrors({})
      },
      onDelete: setDeleteTarget,
    },
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col gap-2.5 border-b border-border/80 bg-background/60 px-4 py-2.5 sm:px-6 sm:py-3">
        <PageHeader
          title="Modules"
          badge={
            <Badge variant="secondary" className="font-mono text-xs">
              {modules.length} module{modules.length !== 1 ? 's' : ''}
            </Badge>
          }
          actions={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {modules.length > 0 ? (
                <DataTableToolbar
                  search={globalFilter}
                  onSearchChange={setGlobalFilter}
                  placeholder="Search modules…"
                >
                  {globalFilter ? (
                    <Badge variant="outline" className="font-mono text-xs tabular-nums">
                      {table.getFilteredRowModel().rows.length} match
                      {table.getFilteredRowModel().rows.length !== 1 ? 'es' : ''}
                    </Badge>
                  ) : null}
                </DataTableToolbar>
              ) : null}
              <Button
                size="sm"
                onClick={() => {
                  resetForm()
                  setShowCreate(true)
                }}
              >
                <Plus data-icon="inline-start" />
                New module
              </Button>
            </div>
          }
        />
      </div>

      <div className="min-h-0 flex-1 bg-card">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        ) : modules.length === 0 ? (
          <EmptyState
            icon={<Boxes />}
            title="No modules yet"
            description="Modules group related strings together."
            action={
              <Button
                onClick={() => {
                  resetForm()
                  setShowCreate(true)
                }}
              >
                <Plus data-icon="inline-start" />
                Create module
              </Button>
            }
          />
        ) : (
          <DataTable table={table} />
        )}
      </div>

      {modules.length > 0 && table.getFilteredRowModel().rows.length > 0 ? (
        <div className="shrink-0 border-t border-border/80 bg-card/90 px-4 backdrop-blur-xs sm:px-6">
          <DataTablePagination table={table} />
        </div>
      ) : null}

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
        <ReviewDialogContent className="sm:max-w-md">
          <ReviewDialogHeader>
            <DialogTitle>{editTarget ? 'Edit module' : 'New module'}</DialogTitle>
            <DialogDescription>Group strings and guide their translations.</DialogDescription>
          </ReviewDialogHeader>
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <ReviewDialogBody>
              <ModuleFormFields
                form={form}
                errors={errors}
                onChange={setForm}
                slugDisabled={!!editTarget}
              />
            </ReviewDialogBody>
            <ReviewDialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => {
                  setShowCreate(false)
                  setEditTarget(null)
                  resetForm()
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
                {(createMut.isPending || updateMut.isPending) && (
                  <Spinner data-icon="inline-start" />
                )}
                {editTarget ? 'Save' : 'Create'}
              </Button>
            </ReviewDialogFooter>
          </form>
        </ReviewDialogContent>
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
