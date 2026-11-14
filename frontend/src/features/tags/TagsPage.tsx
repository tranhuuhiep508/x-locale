import { getRouteApi, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Copy,
  Pencil,
  Plus,
  Tags as TagsIcon,
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
import { TagFormFields } from '@/features/catalog/TagFormFields'
import { TAG_PRESET_COLORS, tagSwatchColor } from '@/features/strings/catalog-create'
import { tagsApi } from '@/lib/api/catalog'
import type { Tag } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { tagsQuery } from '@/lib/queries'
import { tagCreateSchema, type TagCreateForm } from '@/lib/schemas'
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

const routeApi = getRouteApi('/projects/$projectRef/tags')

type FormErrors = Partial<Record<keyof TagCreateForm, string>>
type TagFilter = 'all' | 'in-use' | 'unused'
type TagSort = 'name' | 'most-used' | 'least-used'

const PAGE_SIZE = 24

const TAG_SORT_OPTIONS: CatalogSortOption<TagSort>[] = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'most-used', label: 'Most used' },
  { value: 'least-used', label: 'Least used' },
]

function TagCard({
  tag,
  index,
  projectId,
  maxCount,
  copied,
  onCopyColor,
  onEdit,
  onDelete,
}: {
  tag: Tag
  index: number
  projectId: string
  maxCount: number
  copied: boolean
  onCopyColor: (tag: Tag) => void
  onEdit: (tag: Tag) => void
  onDelete: (tag: Tag) => void
}) {
  const usageWidth =
    maxCount > 0 ? Math.max(tag.string_count > 0 ? 6 : 0, Math.round((tag.string_count / maxCount) * 100)) : 0

  return (
    <div
      role="row"
      style={{ '--stagger': Math.min(index, 12) } as React.CSSProperties}
      className="animate-stage-in group relative overflow-hidden rounded-xl border border-border/85 bg-card shadow-2xs transition-all duration-300 ease-drift hover:-translate-y-0.5 hover:border-border hover:shadow-md focus-within:ring-2 focus-within:ring-ring/40"
    >
      <div role="gridcell" className="relative flex h-full flex-col justify-between gap-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="size-3.5 shrink-0 rounded-full ring-2 ring-background shadow-xs"
                style={{ backgroundColor: tagSwatchColor(tag.color) }}
              />
              <h2 className="truncate font-heading text-base font-semibold tracking-tight text-foreground">
                {tag.name}
              </h2>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onCopyColor(tag)}
                aria-label={`Copy ${tag.color}`}
                title="Copy hex color"
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/45 px-2 py-0.5 font-mono text-2xs uppercase text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
              >
                <span>{tag.color.toUpperCase()}</span>
                {copied ? (
                  <Check className="size-3 text-primary" />
                ) : (
                  <Copy className="size-3 opacity-60" />
                )}
              </button>
              {tag.string_count === 0 ? (
                <Badge variant="outline" className="rounded-md px-1.5 py-0 text-2xs text-muted-foreground">
                  Unused
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onEdit(tag)}
              aria-label={`Edit ${tag.name}`}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(tag)}
              aria-label={`Delete ${tag.name}`}
            >
              <Trash2 />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border/60 pt-3">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-foreground/30 transition-all duration-300"
              style={{ width: `${usageWidth}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-1.5">
              <span className="font-heading text-base font-bold leading-none tabular-nums text-foreground">
                {tag.string_count}
              </span>
              <span className="text-xs text-muted-foreground">
                {tag.string_count === 1 ? 'string' : 'strings'}
              </span>
            </div>
            <Link
              to="/projects/$projectRef/strings"
              params={{ projectRef: projectId }}
              search={{ tag: tag.id }}
              aria-label={`View strings tagged ${tag.name}`}
              className="group/link inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <span>View strings</span>
              <ArrowUpRight className="size-3.5 transition-transform duration-200 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function TagsSkeleton() {
  return (
    <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading tags">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col justify-between gap-4 rounded-xl border border-border/75 bg-card p-4"
        >
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-5 w-28" />
          </div>
          <Skeleton className="h-4 w-20" />
          <div className="flex items-center justify-between border-t border-border/50 pt-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TagsPage() {
  const { projectRef: projectId } = routeApi.useParams()
  const qc = useQueryClient()
  const toast = useToast()
  const { copiedId, copyToken } = useCopiedToken()

  const { data: tags = [], isLoading } = useQuery(tagsQuery(projectId))
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<TagFilter>('all')
  const [sort, setSort] = useState<TagSort>('name')
  const [page, setPage] = useState(1)

  const [showCreate, setShowCreate] = useState(false)
  const [editTarget, setEditTarget] = useState<Tag | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)
  const [form, setForm] = useState<TagCreateForm>({ name: '', color: TAG_PRESET_COLORS[0] })
  const [errors, setErrors] = useState<FormErrors>({})

  function resetForm() {
    setForm({ name: '', color: TAG_PRESET_COLORS[0] })
    setErrors({})
  }

  function openCreate() {
    resetForm()
    setShowCreate(true)
  }

  function openEdit(tag: Tag) {
    setEditTarget(tag)
    setForm({ name: tag.name, color: tag.color })
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

  const totalTaggedRefs = useMemo(
    () => tags.reduce((sum, item) => sum + item.string_count, 0),
    [tags]
  )
  const inUseCount = useMemo(
    () => tags.filter((item) => item.string_count > 0).length,
    [tags]
  )
  const unusedCount = tags.length - inUseCount
  const maxTagCount = useMemo(
    () => tags.reduce((max, item) => Math.max(max, item.string_count), 0),
    [tags]
  )

  const filterOptions: CatalogFilterOption<TagFilter>[] = useMemo(
    () => [
      { value: 'all', label: 'All', count: tags.length },
      { value: 'in-use', label: 'In use', count: inUseCount },
      { value: 'unused', label: 'Unused', count: unusedCount },
    ],
    [tags.length, inUseCount, unusedCount]
  )

  const filteredTags = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matches = tags.filter((item) => {
      if (filter === 'in-use' && item.string_count === 0) return false
      if (filter === 'unused' && item.string_count > 0) return false
      if (!query) return true
      return (
        item.name.toLowerCase().includes(query) || item.color.toLowerCase().includes(query)
      )
    })

    if (sort === 'most-used') {
      return [...matches].sort(
        (a, b) => b.string_count - a.string_count || a.name.localeCompare(b.name)
      )
    }
    if (sort === 'least-used') {
      return [...matches].sort(
        (a, b) => a.string_count - b.string_count || a.name.localeCompare(b.name)
      )
    }
    return [...matches].sort((a, b) => a.name.localeCompare(b.name))
  }, [tags, search, filter, sort])

  const totalPages = Math.max(1, Math.ceil(filteredTags.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const visibleTags = useMemo(
    () => filteredTags.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredTags, currentPage]
  )

  const isFiltered = search.trim().length > 0 || filter !== 'all'
  const isSubmitting = createMut.isPending || updateMut.isPending

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageStickyHeader maxWidth="5xl">
        <PageHeader
          title="Tags"
          badge={
            <Badge variant="secondary" className="font-mono text-xs tabular-nums">
              {tags.length} tag{tags.length !== 1 ? 's' : ''}
            </Badge>
          }
          actions={
            <Button size="sm" onClick={openCreate}>
              <Plus data-icon="inline-start" />
              New tag
            </Button>
          }
        />
      </PageStickyHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
          {isLoading ? (
            <TagsSkeleton />
          ) : tags.length === 0 ? (
            <div className="galley-grid rounded-2xl border border-border/80 bg-card/70 px-4 py-6 sm:px-8">
              <EmptyState
                icon={<TagsIcon />}
                title="No tags yet"
                description="Color-code labels for platforms, release trains, or review states so translators can filter across every module."
                action={
                  <Button onClick={openCreate}>
                    <Plus data-icon="inline-start" />
                    Create tag
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
                      {totalTaggedRefs}
                    </strong>{' '}
                    string assignment{totalTaggedRefs === 1 ? '' : 's'} across{' '}
                    <strong className="font-medium text-foreground tabular-nums">
                      {tags.length}
                    </strong>{' '}
                    tag{tags.length === 1 ? '' : 's'}
                    {unusedCount > 0 ? ` · ${unusedCount} unused` : ''}
                  </span>
                  <div className="flex items-center -space-x-1" aria-hidden="true">
                    {tags.slice(0, 8).map((item) => (
                      <span
                        key={item.id}
                        className="size-3 rounded-full ring-2 ring-background"
                        style={{ backgroundColor: tagSwatchColor(item.color) }}
                      />
                    ))}
                  </div>
                </div>

                <CatalogFilterBar
                  search={search}
                  onSearchChange={(value) => {
                    setSearch(value)
                    setPage(1)
                  }}
                  searchPlaceholder="Search tags…"
                  searchLabel="Search tags"
                  filter={filter}
                  onFilterChange={(value) => {
                    setFilter(value)
                    setPage(1)
                  }}
                  filterOptions={filterOptions}
                  filterLabel="Filter tags"
                  sort={sort}
                  onSortChange={(value) => {
                    setSort(value)
                    setPage(1)
                  }}
                  sortOptions={TAG_SORT_OPTIONS}
                  sortLabel="Sort tags"
                  matchCount={filteredTags.length}
                  isFiltered={isFiltered}
                />
              </div>

              {filteredTags.length === 0 ? (
                <CatalogFilteredEmpty
                  title="No tags match your filter"
                  description="Try another tag name, hex color, or reset the usage filter."
                  onClear={() => {
                    setSearch('')
                    setFilter('all')
                    setPage(1)
                  }}
                />
              ) : (
                <div
                  role="grid"
                  aria-label="Tags catalog"
                  className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {visibleTags.map((tag, index) => (
                    <TagCard
                      key={tag.id}
                      tag={tag}
                      index={index}
                      projectId={projectId}
                      maxCount={maxTagCount}
                      copied={copiedId === tag.id}
                      onCopyColor={(item) => copyToken(item.id, item.color)}
                      onEdit={openEdit}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              )}

              <DataPagination
                page={currentPage}
                pageSize={PAGE_SIZE}
                total={filteredTags.length}
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
        title={`Delete tag "${deleteTarget?.name}"?`}
        description="The tag will be removed from all strings."
        confirmLabel="Delete tag"
        isLoading={deleteMut.isPending}
      />
    </div>
  )
}
