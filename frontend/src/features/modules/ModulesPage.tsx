import { getRouteApi, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Boxes,
  Check,
  Copy,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { PageHeader, PageStickyHeader } from '@/components/layout/PageHeader'
import {
  CatalogFilterBar,
  CatalogFilteredEmpty,
  useCopiedToken,
  type CatalogFilterOption,
  type CatalogSortOption,
} from '@/features/catalog/CatalogFilterBar'
import { ModuleFormFields } from '@/features/catalog/ModuleFormFields'
import { modulesApi } from '@/lib/api/catalog'
import type { Module } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { modulesQuery } from '@/lib/queries'
import { moduleCreateSchema, type ModuleCreateForm } from '@/lib/schemas'
import { useToast } from '@/lib/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataPagination } from '@/components/ui/data-pagination'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import {
  ReviewDialogBody,
  ReviewDialogContent,
  ReviewDialogFooter,
  ReviewDialogHeader,
} from '@/components/layout/ReviewDialog'
import { Skeleton } from '@/components/ui/skeleton'
import { PendingLabel } from '@/components/ui/spinner'

const routeApi = getRouteApi('/projects/$projectRef/modules')

type FormErrors = Partial<Record<keyof ModuleCreateForm, string>>
type ModuleFilter = 'all' | 'with-context' | 'empty'
type ModuleSort = 'order' | 'strings' | 'name'

const PAGE_SIZE = 24

const MODULE_SORT_OPTIONS: CatalogSortOption<ModuleSort>[] = [
  { value: 'order', label: 'Catalog order' },
  { value: 'strings', label: 'Most strings' },
  { value: 'name', label: 'Name A–Z' },
]

function ModuleCard({
  module,
  index,
  projectId,
  totalStrings,
  copied,
  onCopySlug,
  onEdit,
  onDelete,
}: {
  module: Module
  index: number
  projectId: string
  totalStrings: number
  copied: boolean
  onCopySlug: (module: Module) => void
  onEdit: (module: Module) => void
  onDelete: (module: Module) => void
}) {
  const sharePercent =
    totalStrings > 0
      ? Math.max(module.string_count > 0 ? 4 : 0, Math.round((module.string_count / totalStrings) * 100))
      : 0

  return (
    <div
      role="row"
      style={{ '--stagger': Math.min(index, 10) } as React.CSSProperties}
      className="animate-stage-in group relative overflow-hidden rounded-xl border border-border/85 bg-card shadow-2xs transition-all duration-300 ease-drift hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-md focus-within:ring-2 focus-within:ring-primary/35"
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1 origin-center scale-y-0 bg-primary transition-transform duration-300 ease-drift group-hover:scale-y-100"
      />
      <div role="gridcell" className="flex h-full flex-col justify-between gap-4 p-4 pl-5 sm:p-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-muted/50 text-muted-foreground transition-colors group-hover:border-primary/35 group-hover:bg-primary/10 group-hover:text-primary">
                <Boxes className="size-4" />
              </span>
              <div className="min-w-0">
                <h2 className="font-heading text-base font-semibold leading-snug tracking-tight text-foreground wrap-anywhere">
                  {module.name}
                </h2>
                <button
                  type="button"
                  onClick={() => onCopySlug(module)}
                  aria-label={`Copy ${module.slug}`}
                  title="Copy slug"
                  className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/45 px-2 py-0.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground"
                >
                  <code className="truncate">{module.slug}</code>
                  {copied ? (
                    <Check className="size-3 shrink-0 text-primary" />
                  ) : (
                    <Copy className="size-3 shrink-0 opacity-65" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onEdit(module)}
                aria-label={`Edit ${module.name}`}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(module)}
                aria-label={`Delete ${module.name}`}
              >
                <Trash2 />
              </Button>
            </div>
          </div>

          {module.description ? (
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {module.description}
            </p>
          ) : null}

          {module.translation_context ? (
            <div className="rounded-r-lg border-l-2 border-border bg-muted/35 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-3 shrink-0 text-primary" aria-hidden="true" />
                <span className="eyebrow text-3xs">AI guidance</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-foreground/90">
                {module.translation_context}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onEdit(module)}
              className="flex w-fit items-center gap-1.5 rounded-md border border-dashed border-border/80 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
            >
              <Sparkles className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span>Add AI translation guidance</span>
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-foreground/30 transition-all duration-300"
              style={{ width: `${sharePercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-1.5">
              <span className="font-heading text-base font-bold leading-none tabular-nums text-foreground">
                {module.string_count}
              </span>
              <span className="text-xs text-muted-foreground">
                {module.string_count === 1 ? 'string' : 'strings'}
              </span>
            </div>
            <Link
              to="/projects/$projectRef/strings"
              params={{ projectRef: projectId }}
              search={{ module: module.id }}
              aria-label={`View strings in ${module.name}`}
              className="group/link inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <span>Open strings</span>
              <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModulesSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-label="Loading modules">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col justify-between gap-4 rounded-xl border border-border/75 bg-card p-5"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          <Skeleton className="h-12 w-full rounded-lg" />
          <div className="flex items-center justify-between border-t border-border/50 pt-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ModulesPage() {
  const { projectRef: projectId } = routeApi.useParams()
  const qc = useQueryClient()
  const toast = useToast()
  const { copiedId, copyToken } = useCopiedToken()

  const { data: modules = [], isLoading } = useQuery(modulesQuery(projectId))
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ModuleFilter>('all')
  const [sort, setSort] = useState<ModuleSort>('order')
  const [page, setPage] = useState(1)

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

  function openCreate() {
    resetForm()
    setShowCreate(true)
  }

  function openEdit(module: Module) {
    setEditTarget(module)
    setForm({
      slug: module.slug,
      name: module.name,
      description: module.description ?? '',
      translation_context: module.translation_context ?? '',
    })
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

  const totalStrings = useMemo(
    () => modules.reduce((sum, item) => sum + item.string_count, 0),
    [modules]
  )
  const withContextCount = useMemo(
    () => modules.filter((item) => Boolean(item.translation_context?.trim())).length,
    [modules]
  )
  const emptyCount = useMemo(
    () => modules.filter((item) => item.string_count === 0).length,
    [modules]
  )

  const filterOptions: CatalogFilterOption<ModuleFilter>[] = useMemo(
    () => [
      { value: 'all', label: 'All', count: modules.length },
      { value: 'with-context', label: 'AI guidance', count: withContextCount },
      { value: 'empty', label: 'Empty', count: emptyCount },
    ],
    [modules.length, withContextCount, emptyCount]
  )

  const filteredModules = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matches = modules.filter((item) => {
      if (filter === 'with-context' && !item.translation_context?.trim()) return false
      if (filter === 'empty' && item.string_count > 0) return false
      if (!query) return true
      return (
        item.name.toLowerCase().includes(query) ||
        item.slug.toLowerCase().includes(query) ||
        (item.description ?? '').toLowerCase().includes(query) ||
        (item.translation_context ?? '').toLowerCase().includes(query)
      )
    })

    if (sort === 'strings') {
      return [...matches].sort(
        (a, b) => b.string_count - a.string_count || a.name.localeCompare(b.name)
      )
    }
    if (sort === 'name') {
      return [...matches].sort((a, b) => a.name.localeCompare(b.name))
    }
    return matches
  }, [modules, search, filter, sort])

  const totalPages = Math.max(1, Math.ceil(filteredModules.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const visibleModules = useMemo(
    () => filteredModules.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredModules, currentPage]
  )

  const isFiltered = search.trim().length > 0 || filter !== 'all'
  const isSubmitting = createMut.isPending || updateMut.isPending

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageStickyHeader maxWidth="5xl">
        <PageHeader
          title="Modules"
          badge={
            <Badge variant="secondary" className="font-mono text-xs tabular-nums">
              {modules.length} module{modules.length !== 1 ? 's' : ''}
            </Badge>
          }
          actions={
            <Button size="sm" onClick={openCreate}>
              <Plus data-icon="inline-start" />
              New module
            </Button>
          }
        />
      </PageStickyHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
          {isLoading ? (
            <ModulesSkeleton />
          ) : modules.length === 0 ? (
            <div className="galley-grid rounded-2xl border border-border/80 bg-card/70 px-4 py-6 sm:px-8">
              <EmptyState
                icon={<Boxes />}
                title="No modules yet"
                description="Group strings by feature or screen, keep modular export files tidy, and attach AI translation guidance per area."
                action={
                  <Button onClick={openCreate}>
                    <Plus data-icon="inline-start" />
                    Create module
                  </Button>
                }
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    <strong className="font-medium text-foreground tabular-nums">
                      {totalStrings}
                    </strong>{' '}
                    string{totalStrings === 1 ? '' : 's'} organized across{' '}
                    <strong className="font-medium text-foreground tabular-nums">
                      {modules.length}
                    </strong>{' '}
                    namespace{modules.length === 1 ? '' : 's'}
                    {withContextCount > 0 ? (
                      <>
                        {' · '}
                        <span className="text-primary">
                          {withContextCount} with AI guidance
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>

                <CatalogFilterBar
                  search={search}
                  onSearchChange={(value) => {
                    setSearch(value)
                    setPage(1)
                  }}
                  searchPlaceholder="Search modules…"
                  searchLabel="Search modules"
                  filter={filter}
                  onFilterChange={(value) => {
                    setFilter(value)
                    setPage(1)
                  }}
                  filterOptions={filterOptions}
                  filterLabel="Filter modules"
                  sort={sort}
                  onSortChange={(value) => {
                    setSort(value)
                    setPage(1)
                  }}
                  sortOptions={MODULE_SORT_OPTIONS}
                  sortLabel="Sort modules"
                  matchCount={filteredModules.length}
                  isFiltered={isFiltered}
                />
              </div>

              {filteredModules.length === 0 ? (
                <CatalogFilteredEmpty
                  title="No modules match your filter"
                  description="Try a different module name, slug, or switch back to all modules."
                  onClear={() => {
                    setSearch('')
                    setFilter('all')
                    setPage(1)
                  }}
                />
              ) : (
                <div role="grid" aria-label="Modules catalog" className="grid gap-4 md:grid-cols-2">
                  {visibleModules.map((module, index) => (
                    <ModuleCard
                      key={module.id}
                      module={module}
                      index={index}
                      projectId={projectId}
                      totalStrings={totalStrings}
                      copied={copiedId === module.id}
                      onCopySlug={(item) => copyToken(item.id, item.slug)}
                      onEdit={openEdit}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              )}

              <DataPagination
                page={currentPage}
                pageSize={PAGE_SIZE}
                total={filteredModules.length}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </div>

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
              <Button type="submit" disabled={isSubmitting}>
                <PendingLabel pending={isSubmitting}>
                  {editTarget ? 'Save' : 'Create'}
                </PendingLabel>
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
