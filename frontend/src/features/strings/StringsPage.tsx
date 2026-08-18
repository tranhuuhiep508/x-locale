import {
  useCallback,
  useEffect,
  useEffectEvent,
  useState,
  useTransition,
  lazy,
  Suspense,
} from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Filter,
  Plus,
  Search,
  Wand2,
  X,
} from 'lucide-react'
import { BatchActionBar } from '@/features/strings/BatchActionBar'
import { BatchMoveDialog, BatchTagDialog } from '@/features/strings/BatchDialogs'
import { FilterPill, StringRow } from '@/features/strings/StringRow'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataPagination } from '@/components/ui/data-pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { stringsApi } from '@/lib/api/strings'
import type { BatchRequest, StringEntry, TranslateRequest } from '@/lib/api/types'
import {
  modulesQuery,
  projectQuery,
  stringsQuery as stringsQueryOptions,
  tagsQuery,
} from '@/lib/queries'
import { queryKeys } from '@/lib/query-keys'
import { resolveStringsSearch } from '@/lib/schemas'
import type { StringsSearch } from '@/lib/schemas'
import { useToast } from '@/lib/toast'

const StringFormDialog = lazy(() => import('@/features/strings/StringFormDialog'))

const stringsRoute = getRouteApi('/projects/$projectId/strings')

export function StringsPage() {
  const { projectId } = stringsRoute.useParams()
  const rawSearch = stringsRoute.useSearch()
  const search = resolveStringsSearch(rawSearch)
  const navigate = useNavigate({ from: '/projects/$projectId/strings' })
  const [, startTransition] = useTransition()
  const qc = useQueryClient()
  const toast = useToast()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogEntry, setDialogEntry] = useState<StringEntry | null>(null)
  const [showMoveModule, setShowMoveModule] = useState(false)
  const [showAddTags, setShowAddTags] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [searchInput, setSearchInput] = useState(search.q ?? '')

  useEffect(() => {
    setSearchInput(search.q ?? '')
  }, [search.q])

  const applySearchQ = useEffectEvent((value: string) => {
    startTransition(() => {
      navigate({
        search: (prev) => ({
          ...prev,
          q: value || undefined,
          page: 1,
        }),
      })
    })
  })

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = searchInput.trim()
      const current = (search.q ?? '').trim()
      if (next !== current) {
        applySearchQ(next)
      }
    }, 300)
    return () => window.clearTimeout(handle)
  }, [searchInput, search.q])

  const stringsResult = useQuery(stringsQueryOptions(projectId, search))
  const { data: modules = [] } = useQuery(modulesQuery(projectId))
  const { data: tags = [] } = useQuery(tagsQuery(projectId))
  const { data: project } = useQuery(projectQuery(projectId))

  const invalidateStrings = useCallback(() => {
    qc.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
    qc.invalidateQueries({ queryKey: queryKeys.projects.activities.all(projectId) })
  }, [qc, projectId])

  const batchMut = useMutation({
    mutationFn: (req: BatchRequest) => stringsApi.batch(projectId, req),
    onSuccess: () => {
      invalidateStrings()
      setSelectedIds(new Set())
      setShowMoveModule(false)
      setShowAddTags(false)
      setDeleteConfirm(false)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Batch action failed'),
  })

  const translateMut = useMutation({
    mutationFn: (req: TranslateRequest) => stringsApi.translate(projectId, req),
    onSuccess: (res) => {
      if (res.translated_count > 0) {
        toast.success(`Translating ${res.translated_count} string(s)…`)
      } else {
        toast.info('Nothing to translate')
      }
      invalidateStrings()
    },
    onError: () => toast.error('Translation failed — check Bedrock credentials'),
  })

  function setFilter(updates: Partial<StringsSearch>) {
    startTransition(() => {
      navigate({ search: (prev) => ({ ...prev, ...updates, page: 1 }) })
    })
  }

  const strings = stringsResult.data?.items ?? []
  const total = stringsResult.data?.total ?? 0
  const targetLocales = project?.target_languages ?? []
  const hasActiveFilters = Boolean(
    search.q || search.module || search.tag || search.status || search.missing_locale,
  )

  const moduleById = new Map(modules.map((m) => [m.id, m]))
  const tagById = new Map(tags.map((t) => [t.id, t]))

  const allSelected = strings.length > 0 && strings.every((s) => selectedIds.has(s.id))

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(strings.map((s) => s.id)))
    }
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedList = [...selectedIds]

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80 border-b px-4 py-3">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 w-56"
              placeholder="Search strings…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search strings"
            />
          </div>

          {modules.length > 0 && (
            <Select
              value={search.module ?? 'all'}
              onValueChange={(v) => setFilter({ module: v === 'all' ? undefined : v })}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All modules" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All modules</SelectItem>
                  {modules.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}

          {tags.length > 0 && (
            <Select
              value={search.tag ?? 'all'}
              onValueChange={(v) => setFilter({ tag: v === 'all' ? undefined : v })}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="All tags" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All tags</SelectItem>
                  {tags.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}

          <Select
            value={search.status ?? 'all'}
            onValueChange={(v) =>
              setFilter({ status: v === 'all' ? undefined : (v as StringsSearch['status']) })
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Any status" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="public">Public</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          {targetLocales.length > 0 && (
            <Select
              value={search.missing_locale ?? 'all'}
              onValueChange={(v) => setFilter({ missing_locale: v === 'all' ? undefined : v })}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All locales" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All locales</SelectItem>
                  {targetLocales.map((l) => (
                    <SelectItem key={l} value={l}>
                      Missing: {l}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput('')
                navigate({
                  search: { page: 1, page_size: search.page_size },
                })
              }}
              className="text-muted-foreground"
            >
              <X data-icon="inline-start" />
              Clear
            </Button>
          )}

          <div className="flex-1" />

          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              translateMut.mutate({ scope: 'missing', locales: targetLocales })
            }
            disabled={translateMut.isPending}
          >
            {translateMut.isPending ? <Spinner data-icon="inline-start" /> : <Wand2 data-icon="inline-start" />}
            Translate missing
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setDialogEntry(null)
              setDialogOpen(true)
            }}
          >
            <Plus data-icon="inline-start" />
            Add string
          </Button>
        </div>

        {hasActiveFilters && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
            {search.q && (
              <FilterPill label={`"${search.q}"`} onRemove={() => {
                setSearchInput('')
                setFilter({ q: undefined })
              }} />
            )}
            {search.module && (
              <FilterPill
                label={`module: ${moduleById.get(search.module)?.name ?? search.module}`}
                onRemove={() => setFilter({ module: undefined })}
              />
            )}
            {search.tag && (
              <FilterPill
                label={`tag: ${tagById.get(search.tag)?.name ?? search.tag}`}
                onRemove={() => setFilter({ tag: undefined })}
              />
            )}
            {search.status && (
              <FilterPill
                label={search.status}
                onRemove={() => setFilter({ status: undefined })}
              />
            )}
            {search.missing_locale && (
              <FilterPill
                label={`missing: ${search.missing_locale}`}
                onRemove={() => setFilter({ missing_locale: undefined })}
              />
            )}
          </div>
        )}
      </div>

      {selectedIds.size > 0 && (
        <BatchActionBar
          selectedCount={selectedIds.size}
          modules={modules}
          tags={tags}
          onPublish={() => batchMut.mutate({ action: 'publish', string_ids: selectedList })}
          onUnpublish={() => batchMut.mutate({ action: 'unpublish', string_ids: selectedList })}
          onMove={() => setShowMoveModule(true)}
          onAddTags={() => setShowAddTags(true)}
          onDelete={() => setDeleteConfirm(true)}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      <div className="flex-1 overflow-x-auto">
        {stringsResult.isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Spinner />
          </div>
        ) : strings.length === 0 ? (
          <EmptyState
            title="No strings found"
            description={
              hasActiveFilters
                ? 'Try adjusting your filters.'
                : 'Add your first string to get started.'
            }
            action={
              !hasActiveFilters ? (
                <Button
                  onClick={() => {
                    setDialogEntry(null)
                    setDialogOpen(true)
                  }}
                >
                  <Plus data-icon="inline-start" />
                  Add string
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={() => toggleAll()}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="min-w-[160px]">Key</TableHead>
                <TableHead className="min-w-[200px]">Source</TableHead>
                {targetLocales.map((l) => (
                  <TableHead key={l} className="min-w-[160px] uppercase text-xs tracking-wide">
                    {l}
                  </TableHead>
                ))}
                <TableHead className="w-28">Published</TableHead>
                <TableHead className="min-w-[120px]">Tags</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {strings.map((s) => (
                <StringRow
                  key={s.id}
                  entry={s}
                  projectId={projectId}
                  targetLocales={targetLocales}
                  selected={selectedIds.has(s.id)}
                  onToggle={() => toggleRow(s.id)}
                  onEdit={() => {
                    setDialogEntry(s)
                    setDialogOpen(true)
                  }}
                  onRefresh={invalidateStrings}
                  onTranslate={(id) =>
                    translateMut.mutate({
                      scope: 'strings',
                      string_ids: [id],
                      locales: targetLocales,
                    })
                  }
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {total > search.page_size && (
        <div className="border-t px-4">
          <DataPagination
            page={search.page}
            pageSize={search.page_size}
            total={total}
            onPageChange={(p) => navigate({ search: (prev) => ({ ...prev, page: p }) })}
          />
        </div>
      )}

      {dialogOpen && (
        <Suspense fallback={null}>
          <StringFormDialog
            key={dialogEntry?.id ?? 'new'}
            projectId={projectId}
            entry={dialogEntry}
            modules={modules}
            tags={tags}
            targetLocales={targetLocales}
            onClose={() => {
              setDialogOpen(false)
              setDialogEntry(null)
            }}
            onSuccess={() => {
              setDialogOpen(false)
              setDialogEntry(null)
              invalidateStrings()
            }}
          />
        </Suspense>
      )}

      <BatchMoveDialog
        open={showMoveModule}
        onClose={() => setShowMoveModule(false)}
        modules={modules}
        onSelect={(moduleId) =>
          batchMut.mutate({
            action: 'move_module',
            string_ids: selectedList,
            payload: { module_id: moduleId },
          })
        }
        isLoading={batchMut.isPending}
      />

      <BatchTagDialog
        open={showAddTags}
        onClose={() => setShowAddTags(false)}
        tags={tags}
        onApply={(tagIds) =>
          batchMut.mutate({
            action: 'add_tags',
            string_ids: selectedList,
            payload: { tag_ids: tagIds },
          })
        }
        isLoading={batchMut.isPending}
      />

      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={() =>
          batchMut.mutate({ action: 'delete', string_ids: selectedList })
        }
        title={`Delete ${selectedIds.size} string${selectedIds.size > 1 ? 's' : ''}?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        isLoading={batchMut.isPending}
      />
    </div>
  )
}
