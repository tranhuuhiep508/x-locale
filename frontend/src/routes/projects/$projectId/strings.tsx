import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  useState,
  useCallback,
  useTransition,
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
} from 'react'
import {
  Search,
  Filter,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  MoveRight,
  Tag as TagIcon,
  Wand2,
  X,
  Pencil,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import type {
  StringEntry,
  StringListResponse,
  Module,
  Tag,
  Translation,
  BatchRequest,
  TranslateRequest,
  TranslateResult,
} from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'
import { stringsSearchSchema, resolveStringsSearch } from '@/lib/schemas'
import type { StringsSearch } from '@/lib/schemas'
import {
  Button,
  Badge,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Checkbox,
  DataPagination,
  EmptyState,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ConfirmDialog,
  Spinner,
  Switch,
} from '@/components/ui'
import { useToast } from '@/store'

const StringCreateDialog = lazy(() => import('@/components/strings/StringCreateDialog'))
const StringEditDialog = lazy(() => import('@/components/strings/StringEditDialog'))

export const Route = createFileRoute('/projects/$projectId/strings')({
  validateSearch: (s: Record<string, unknown>) => stringsSearchSchema.parse(s),
  component: StringsPage,
})

// ─── Batch move module dialog ─────────────────────────────────────────────────

function BatchMoveDialog({
  open,
  onClose,
  modules,
  onSelect,
  isLoading,
}: {
  open: boolean
  onClose: () => void
  modules: Module[]
  onSelect: (moduleId: string | null) => void
  isLoading: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !isLoading) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move to module</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground italic"
            onClick={() => onSelect(null)}
          >
            — No module —
          </Button>
          {modules.map((m) => (
            <Button
              key={m.id}
              variant="ghost"
              className="w-full justify-start"
              onClick={() => onSelect(m.id)}
            >
              <span className="font-mono text-xs text-muted-foreground mr-2">{m.slug}</span>
              {m.name}
            </Button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Batch add tags dialog ────────────────────────────────────────────────────

function BatchTagDialog({
  open,
  onClose,
  tags,
  onApply,
  isLoading,
}: {
  open: boolean
  onClose: () => void
  tags: Tag[]
  onApply: (tagIds: string[]) => void
  isLoading: boolean
}) {
  const [selected, setSelected] = useState<string[]>([])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !isLoading) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add tags</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {tags.map((t) => (
            <label
              key={t.id}
              className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-muted cursor-pointer"
            >
              <Checkbox
                checked={selected.includes(t.id)}
                onCheckedChange={(checked) =>
                  setSelected((prev) =>
                    checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
                  )
                }
              />
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: t.color }}
              />
              <span className="text-sm">{t.name}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => onApply(selected)} disabled={selected.length === 0 || isLoading}>
            {isLoading && <Spinner data-icon="inline-start" />}
            Add tags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

function StringsPage() {
  const { projectId } = Route.useParams()
  const rawSearch = Route.useSearch()
  const search = resolveStringsSearch(rawSearch)
  const navigate = useNavigate({ from: Route.fullPath })
  const [, startTransition] = useTransition()
  const qc = useQueryClient()
  const toast = useToast()

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showCreate, setShowCreate] = useState(false)
  const [editingEntry, setEditingEntry] = useState<StringEntry | null>(null)
  const [showMoveModule, setShowMoveModule] = useState(false)
  const [showAddTags, setShowAddTags] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [searchInput, setSearchInput] = useState(search.q ?? '')

  // Keep local search box in sync when URL filters change externally
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

  const stringsQuery = useQuery<StringListResponse>({
    queryKey: queryKeys.strings(projectId, search),
    queryFn: () =>
      api.get<StringListResponse>(`/projects/${projectId}/strings`, {
        // Backend query params are `module` / `tag` (not module_id / tag_id)
        module: search.module,
        tag: search.tag,
        q: search.q,
        missing_locale: search.missing_locale,
        status: search.status,
        page: search.page,
        page_size: search.page_size,
      }),
    placeholderData: (prev) => prev,
  })

  const { data: modules = [] } = useQuery<Module[]>({
    queryKey: queryKeys.modules(projectId),
    queryFn: () => api.get<Module[]>(`/projects/${projectId}/modules`),
  })

  const { data: tags = [] } = useQuery<Tag[]>({
    queryKey: queryKeys.tags(projectId),
    queryFn: () => api.get<Tag[]>(`/projects/${projectId}/tags`),
  })

  const { data: project } = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => api.get<{ target_languages: string[] }>(`/projects/${projectId}`),
  })

  const invalidateStrings = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['projects', projectId, 'strings'] })
  }, [qc, projectId])

  const batchMut = useMutation({
    mutationFn: (req: BatchRequest) =>
      api.post(`/projects/${projectId}/strings/batch`, req),
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
    mutationFn: (req: TranslateRequest) =>
      api.post<TranslateResult>(`/projects/${projectId}/translate`, req),
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

  const strings = stringsQuery.data?.items ?? []
  const total = stringsQuery.data?.total ?? 0
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
      {/* Filters bar */}
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

          <Button size="sm" onClick={() => setShowCreate(true)}>
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

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="sticky top-[57px] z-10 bg-primary text-primary-foreground px-4 py-2 flex items-center gap-3">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                batchMut.mutate({ action: 'publish', string_ids: selectedList })
              }
            >
              <CheckCircle data-icon="inline-start" />
              Publish
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                batchMut.mutate({ action: 'unpublish', string_ids: selectedList })
              }
            >
              <XCircle data-icon="inline-start" />
              Unpublish
            </Button>
            {modules.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setShowMoveModule(true)}>
                <MoveRight data-icon="inline-start" />
                Move module
              </Button>
            )}
            {tags.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setShowAddTags(true)}>
                <TagIcon data-icon="inline-start" />
                Add tags
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(true)}>
              <Trash2 data-icon="inline-start" />
              Delete
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            onClick={() => setSelectedIds(new Set())}
          >
            <X />
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-x-auto">
        {stringsQuery.isLoading ? (
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
                <Button onClick={() => setShowCreate(true)}>
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
                  onEdit={() => setEditingEntry(s)}
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

      {showCreate && (
        <Suspense fallback={null}>
          <StringCreateDialog
            projectId={projectId}
            modules={modules}
            tags={tags}
            onClose={() => setShowCreate(false)}
            onSuccess={() => {
              setShowCreate(false)
              invalidateStrings()
            }}
          />
        </Suspense>
      )}

      {editingEntry && (
        <Suspense fallback={null}>
          <StringEditDialog
            projectId={projectId}
            entry={editingEntry}
            modules={modules}
            tags={tags}
            targetLocales={targetLocales}
            onClose={() => setEditingEntry(null)}
            onSuccess={() => {
              setEditingEntry(null)
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

// ─── Filter pill ──────────────────────────────────────────────────────────────

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1">
      {label}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        className="size-4 text-muted-foreground hover:text-destructive"
        aria-label={`Remove ${label} filter`}
      >
        <X />
      </Button>
    </Badge>
  )
}

// ─── Readonly translation preview ─────────────────────────────────────────────

function TranslationPreview({ translation }: { translation?: Translation }) {
  const value = translation?.value?.trim() ?? ''

  if (!value) {
    return (
      <span className="text-muted-foreground/70 italic text-sm">Missing</span>
    )
  }

  return (
    <p className="text-sm leading-snug line-clamp-2 whitespace-normal wrap-break-word">
      {value}
    </p>
  )
}

// ─── String row ───────────────────────────────────────────────────────────────

interface StringRowProps {
  entry: StringEntry
  projectId: string
  targetLocales: string[]
  selected: boolean
  onToggle: () => void
  onEdit: () => void
  onRefresh: () => void
  onTranslate: (id: string) => void
}

function StringRow({
  entry,
  projectId,
  targetLocales,
  selected,
  onToggle,
  onEdit,
  onRefresh,
  onTranslate,
}: StringRowProps) {
  const toast = useToast()

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/strings/${entry.id}`),
    onSuccess: () => {
      onRefresh()
      toast.success('String deleted')
    },
    onError: () => toast.error('Failed to delete string'),
  })

  const publishMut = useMutation({
    mutationFn: (publish: boolean) =>
      api.post(`/projects/${projectId}/strings/batch`, {
        action: publish ? 'publish' : 'unpublish',
        string_ids: [entry.id],
      } satisfies BatchRequest),
    onSuccess: (_data, publish) => {
      onRefresh()
      toast.success(publish ? 'Published' : 'Moved to draft')
    },
    onError: () => toast.error('Failed to update status'),
  })

  const translationsByLocale: Record<string, Translation | undefined> = {}
  for (const t of entry.translations) {
    translationsByLocale[t.locale] = t
  }

  const isPublic = entry.status === 'public'

  return (
    <TableRow
      data-state={selected ? 'selected' : undefined}
      className="cursor-pointer group"
      onClick={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('button, input, [role="checkbox"], [role="switch"], a')) return
        onEdit()
      }}
    >
      <TableCell className="align-middle" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={() => onToggle()} aria-label="Select row" />
      </TableCell>
      <TableCell className="align-middle whitespace-normal max-w-[220px]">
        <div className="space-y-1">
          <span className="font-mono text-xs text-foreground break-all leading-relaxed">
            {entry.key}
          </span>
          {entry.module_slug && (
            <p className="text-[11px] text-muted-foreground font-mono">{entry.module_slug}</p>
          )}
        </div>
      </TableCell>
      <TableCell className="align-middle max-w-[260px] whitespace-normal">
        <p className="text-sm text-foreground leading-relaxed line-clamp-2">{entry.source_text}</p>
        {entry.description ? (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{entry.description}</p>
        ) : null}
      </TableCell>
      {targetLocales.map((locale) => (
        <TableCell key={locale} className="align-middle min-w-[160px] whitespace-normal">
          <TranslationPreview translation={translationsByLocale[locale]} />
        </TableCell>
      ))}
      <TableCell className="align-middle" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Switch
            size="sm"
            checked={isPublic}
            disabled={publishMut.isPending}
            onCheckedChange={(checked) => publishMut.mutate(checked)}
            aria-label={isPublic ? 'Published' : 'Draft'}
          />
          <span className="text-xs text-muted-foreground">
            {publishMut.isPending ? '…' : isPublic ? 'Public' : 'Draft'}
          </span>
        </div>
      </TableCell>
      <TableCell className="align-middle whitespace-normal">
        {entry.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {entry.tags.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: t.color + '22', color: t.color }}
              >
                {t.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="align-middle text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-0.5 opacity-70 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Edit"
            onClick={onEdit}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="AI Translate"
            onClick={() => onTranslate(entry.id)}
            className="text-muted-foreground hover:text-primary"
          >
            <Wand2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete"
            onClick={() => deleteMut.mutate()}
            disabled={deleteMut.isPending}
            className="text-muted-foreground hover:text-destructive"
          >
            {deleteMut.isPending ? <Spinner /> : <Trash2 />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}
