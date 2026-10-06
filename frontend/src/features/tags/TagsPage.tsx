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
import { Plus, Tags as TagsIcon } from 'lucide-react'
import { DataTable } from '@/components/data-table/data-table'
import { PageBody, PageHeader } from '@/components/layout/PageHeader'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { tagsApi } from '@/lib/api/catalog'
import type { Tag } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { tagsQuery } from '@/lib/queries'
import { tagCreateSchema } from '@/lib/schemas'
import type { TagCreateForm } from '@/lib/schemas'
import { TagFormFields } from '@/features/catalog/TagFormFields'
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
import { tagColumns } from '@/features/tags/tags-columns'
const routeApi = getRouteApi('/projects/$projectRef/tags')

type FormErrors = Partial<Record<keyof TagCreateForm, string>>

export function TagsPage() {
  const { projectRef: projectId } = routeApi.useParams()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: tags = [], isLoading } = useQuery(tagsQuery(projectId))
  const data = useMemo(() => tags, [tags])
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 })

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
    mutationFn: (data: TagCreateForm) => tagsApi.create(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.tags(projectId) })
      toast.success('Tag created')
      setShowCreate(false)
      resetForm()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to create tag'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<TagCreateForm> }) =>
      tagsApi.update(projectId, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.tags(projectId) })
      toast.success('Tag updated')
      setEditTarget(null)
      resetForm()
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Failed to update tag'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => tagsApi.delete(projectId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.tags(projectId) })
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

  const table = useReactTable({
    data,
    columns: tagColumns,
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
      onEdit: (tag: Tag) => {
        setEditTarget(tag)
        setForm({ name: tag.name, color: tag.color })
        setErrors({})
      },
      onDelete: setDeleteTarget,
    },
  })

  return (
    <PageBody>
      <PageHeader
        eyebrow="Catalog"
        title="Tags"
        description="Label strings to keep your catalog easy to navigate."
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="font-mono text-xs">
              {tags.length} tag{tags.length !== 1 ? 's' : ''}
            </Badge>
            <Button
              size="sm"
              onClick={() => {
                resetForm()
                setShowCreate(true)
              }}
            >
              <Plus data-icon="inline-start" />
              New tag
            </Button>
          </div>
        }
      />

      {isLoading ? null : tags.length === 0 ? (
        <EmptyState
          icon={<TagsIcon />}
          title="No tags yet"
          description="Tags help categorize and filter strings."
          action={
            <Button
              onClick={() => {
                resetForm()
                setShowCreate(true)
              }}
            >
              <Plus data-icon="inline-start" />
              Create tag
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-card p-4 shadow-xs">
          <DataTableToolbar
            search={globalFilter}
            onSearchChange={setGlobalFilter}
            placeholder="Search tags…"
          />
          <DataTable table={table} />
          <DataTablePagination table={table} />
        </div>
      )}

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
            <DialogTitle>{editTarget ? 'Edit tag' : 'New tag'}</DialogTitle>
            <DialogDescription>Choose a label and color for your strings.</DialogDescription>
          </ReviewDialogHeader>
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <ReviewDialogBody>
              <TagFormFields form={form} errors={errors} onChange={setForm} />
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
        title={`Delete tag "${deleteTarget?.name}"?`}
        description="The tag will be removed from all strings."
        confirmLabel="Delete tag"
        isLoading={deleteMut.isPending}
      />
    </PageBody>
  )
}
