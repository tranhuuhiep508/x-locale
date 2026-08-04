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
  useRef,
  useEffect,
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
} from 'lucide-react'
import { api } from '../../../lib/api/client'
import type {
  StringEntry,
  StringListResponse,
  Module,
  Tag,
  Translation,
  BatchRequest,
  TranslateRequest,
  TranslateResult,
} from '../../../lib/api/types'
import { queryKeys } from '../../../lib/query-keys'
import { stringsSearchSchema, resolveStringsSearch } from '../../../lib/schemas'
import type { StringsSearch } from '../../../lib/schemas'
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
  Textarea,
  DataPagination,
  EmptyState,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ConfirmDialog,
  Spinner,
} from '../../../components/ui'
import { useToast } from '../../../store'
import { cn } from '../../../lib/utils'

const StringCreateDialog = lazy(() => import('../../../components/strings/StringCreateDialog'))

export const Route = createFileRoute('/projects/$projectId/strings')({
  validateSearch: (s: Record<string, unknown>) => stringsSearchSchema.parse(s),
  component: StringsPage,
})

// ─── Inline translation cell ─────────────────────────────────────────────────

interface TranslationCellProps {
  stringId: string
  projectId: string
  locale: string
  translation?: Translation
  onSaved: () => void
}

function TranslationCell({
  stringId,
  projectId,
  locale,
  translation,
  onSaved,
}: TranslationCellProps) {
  const [value, setValue] = useState(translation?.value ?? '')
  const originalRef = useRef(translation?.value ?? '')
  const toast = useToast()

  useEffect(() => {
    const v = translation?.value ?? ''
    setValue(v)
    originalRef.current = v
  }, [translation?.value])

  const saveMut = useMutation({
    mutationFn: (val: string) =>
      api.put(`/projects/${projectId}/strings/${stringId}/translations/${locale}`, { value: val }),
    onSuccess: () => onSaved(),
    onError: () => toast.error('Failed to save translation'),
  })

  const handleBlur = useCallback(() => {
    if (value !== originalRef.current) {
      originalRef.current = value
      saveMut.mutate(value)
    }
  }, [value, saveMut])

  return (
    <Textarea
      className={cn(
        'min-h-[42px] resize-none text-sm',
        saveMut.isPending && 'border-primary/40 bg-primary/5',
      )}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      rows={2}
      placeholder={`${locale}…`}
    />
  )
}

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
  const [showMoveModule, setShowMoveModule] = useState(false)
  const [showAddTags, setShowAddTags] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const stringsQuery = useQuery<StringListResponse>({
    queryKey: queryKeys.strings(projectId, search),
    queryFn: () =>
      api.get<StringListResponse>(`/projects/${projectId}/strings`, {
        module_id: search.module,
        tag_id: search.tag,
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
    qc.invalidateQueries({ queryKey: queryKeys.strings(projectId, search) })
    qc.invalidateQueries({ queryKey: queryKeys.project(projectId) })
  }, [qc, projectId, search])

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
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3">
        <div className="flex flex-wrap gap-2 items-center">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 w-56"
              placeholder="Search strings…"
              value={search.q ?? ''}
              onChange={(e) => setFilter({ q: e.target.value || undefined })}
            />
          </div>

          {/* Module filter */}
          {modules.length > 0 && (
            <Select
              value={search.module ?? 'all'}
              onValueChange={(v) => setFilter({ module: v === 'all' ? undefined : v })}
            >
              <SelectTrigger className="w-36">
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

          {/* Tag filter */}
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

          {/* Status filter */}
          <Select
            value={search.status ?? 'all'}
            onValueChange={(v) =>
              setFilter({ status: v === 'all' ? undefined : (v as StringsSearch['status']) })
            }
          >
            <SelectTrigger className="w-32">
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

          {/* Missing locale filter */}
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

          {/* Clear filters */}
          {(search.q || search.module || search.tag || search.status || search.missing_locale) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigate({
                  search: { page: 1, page_size: search.page_size },
                })
              }
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

        {/* Active filter pills */}
        {(search.q || search.module || search.tag || search.status || search.missing_locale) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
            {search.q && (
              <FilterPill label={`"${search.q}"`} onRemove={() => setFilter({ q: undefined })} />
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
              search.q || search.module || search.tag || search.status || search.missing_locale
                ? 'Try adjusting your filters.'
                : 'Add your first string to get started.'
            }
            action={
              !search.q &&
              !search.module &&
              !search.tag &&
              !search.status &&
              !search.missing_locale ? (
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
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={() => toggleAll()}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="w-40">Key</TableHead>
                <TableHead className="w-52">Source</TableHead>
                {targetLocales.map((l) => (
                  <TableHead key={l} className="min-w-[180px]">
                    {l}
                  </TableHead>
                ))}
                <TableHead>Tags / Module</TableHead>
                <TableHead className="w-10" />
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

      {/* Pagination */}
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

      {/* Dialogs */}
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

// ─── String row ───────────────────────────────────────────────────────────────

interface StringRowProps {
  entry: StringEntry
  projectId: string
  targetLocales: string[]
  selected: boolean
  onToggle: () => void
  onRefresh: () => void
  onTranslate: (id: string) => void
}

function StringRow({
  entry,
  projectId,
  targetLocales,
  selected,
  onToggle,
  onRefresh,
  onTranslate,
}: StringRowProps) {
  const toast = useToast()
  const qc = useQueryClient()

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/projects/${projectId}/strings/${entry.id}`),
    onSuccess: () => {
      onRefresh()
      toast.success('String deleted')
    },
    onError: () => toast.error('Failed to delete string'),
  })

  const translationsByLocale: Record<string, Translation | undefined> = {}
  for (const t of entry.translations) {
    translationsByLocale[t.locale] = t
  }

  const allFilled = targetLocales.every((l) => (translationsByLocale[l]?.value ?? '') !== '')

  return (
    <TableRow data-state={selected ? 'selected' : undefined}>
      <TableCell className="align-top">
        <Checkbox checked={selected} onCheckedChange={() => onToggle()} aria-label="Select row" />
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <span className="font-mono text-xs text-foreground break-all">{entry.key}</span>
        {entry.module_slug && (
          <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{entry.module_slug}</p>
        )}
        <div className="flex flex-wrap gap-1 mt-1">
          {entry.tags.map((t) => (
            <span
              key={t.id}
              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
              style={{ backgroundColor: t.color + '22', color: t.color }}
            >
              {t.name}
            </span>
          ))}
        </div>
        <Badge
          variant={allFilled ? 'default' : 'secondary'}
          className="mt-1 text-[10px]"
        >
          {allFilled ? 'public' : 'draft'}
        </Badge>
      </TableCell>
      <TableCell className="align-top max-w-[220px] whitespace-normal">
        <p className="text-sm text-foreground leading-relaxed line-clamp-3">{entry.source_text}</p>
        {entry.description && (
          <p className="text-xs text-muted-foreground mt-1 italic">{entry.description}</p>
        )}
      </TableCell>
      {targetLocales.map((locale) => (
        <TableCell key={locale} className="align-top min-w-[180px] whitespace-normal">
          <TranslationCell
            stringId={entry.id}
            projectId={projectId}
            locale={locale}
            translation={translationsByLocale[locale]}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: queryKeys.project(projectId) })
            }}
          />
        </TableCell>
      ))}
      <TableCell className="align-top">
        <div className="flex items-center gap-1">
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
