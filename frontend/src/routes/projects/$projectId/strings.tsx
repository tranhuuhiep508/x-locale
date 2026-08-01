import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  useQuery,
  useMutation,
  useQueryClient,
  useIsMutating,
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
  ChevronDown,
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
  Pagination,
  EmptyState,
  Dialog,
  DialogFooter,
  ConfirmDialog,
  Spinner,
  Label,
  FormField,
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
    <textarea
      className={cn(
        'w-full resize-none text-sm border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400 min-h-[42px]',
        saveMut.isPending ? 'border-brand-300 bg-brand-50/30' : 'border-transparent hover:border-slate-300 bg-transparent',
        value === '' && 'placeholder-slate-300',
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
    <Dialog open={open} onClose={onClose} title="Move to module">
      <div className="space-y-2 max-h-64 overflow-y-auto">
        <button
          className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-50 text-slate-500 italic"
          onClick={() => onSelect(null)}
        >
          — No module —
        </button>
        {modules.map((m) => (
          <button
            key={m.id}
            className="w-full text-left px-3 py-2 text-sm rounded hover:bg-brand-50 hover:text-brand-700"
            onClick={() => onSelect(m.id)}
          >
            <span className="font-mono text-xs text-slate-400 mr-2">{m.slug}</span>
            {m.name}
          </button>
        ))}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isLoading}>
          Cancel
        </Button>
      </DialogFooter>
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
    <Dialog open={open} onClose={onClose} title="Add tags">
      <div className="space-y-1 max-h-64 overflow-y-auto mb-2">
        {tags.map((t) => (
          <label
            key={t.id}
            className="flex items-center gap-2 px-3 py-2 rounded hover:bg-slate-50 cursor-pointer"
          >
            <input
              type="checkbox"
              className="rounded border-slate-300"
              checked={selected.includes(t.id)}
              onChange={(e) =>
                setSelected((prev) =>
                  e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id),
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
        <Button
          onClick={() => onApply(selected)}
          disabled={selected.length === 0}
          isLoading={isLoading}
        >
          Add tags
        </Button>
      </DialogFooter>
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
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex flex-wrap gap-2 items-center">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
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
              className="w-36"
              value={search.module ?? ''}
              onChange={(e) => setFilter({ module: e.target.value || undefined })}
            >
              <option value="">All modules</option>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}

          {/* Tag filter */}
          {tags.length > 0 && (
            <Select
              className="w-36"
              value={search.tag ?? ''}
              onChange={(e) => setFilter({ tag: e.target.value || undefined })}
            >
              <option value="">All tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}

          {/* Status filter */}
          <Select
            className="w-32"
            value={search.status ?? ''}
            onChange={(e) =>
              setFilter({ status: (e.target.value as StringsSearch['status']) || undefined })
            }
          >
            <option value="">Any status</option>
            <option value="draft">Draft</option>
            <option value="public">Public</option>
          </Select>

          {/* Missing locale filter */}
          {targetLocales.length > 0 && (
            <Select
              className="w-40"
              value={search.missing_locale ?? ''}
              onChange={(e) => setFilter({ missing_locale: e.target.value || undefined })}
            >
              <option value="">All locales</option>
              {targetLocales.map((l) => (
                <option key={l} value={l}>
                  Missing: {l}
                </option>
              ))}
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
              className="text-slate-500"
            >
              <X className="h-3.5 w-3.5" />
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
            isLoading={translateMut.isPending}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Translate missing
          </Button>

          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add string
          </Button>
        </div>

        {/* Active filter pills */}
        {(search.q || search.module || search.tag || search.status || search.missing_locale) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Filter className="h-3.5 w-3.5 text-slate-400 mt-0.5" />
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
        <div className="sticky top-[57px] z-10 bg-brand-600 text-white px-4 py-2 flex items-center gap-3">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-1.5">
            <button
              className="flex items-center gap-1 px-3 py-1 text-xs bg-brand-700 hover:bg-brand-800 rounded"
              onClick={() =>
                batchMut.mutate({ action: 'publish', string_ids: selectedList })
              }
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Publish
            </button>
            <button
              className="flex items-center gap-1 px-3 py-1 text-xs bg-brand-700 hover:bg-brand-800 rounded"
              onClick={() =>
                batchMut.mutate({ action: 'unpublish', string_ids: selectedList })
              }
            >
              <XCircle className="h-3.5 w-3.5" />
              Unpublish
            </button>
            {modules.length > 0 && (
              <button
                className="flex items-center gap-1 px-3 py-1 text-xs bg-brand-700 hover:bg-brand-800 rounded"
                onClick={() => setShowMoveModule(true)}
              >
                <MoveRight className="h-3.5 w-3.5" />
                Move module
              </button>
            )}
            {tags.length > 0 && (
              <button
                className="flex items-center gap-1 px-3 py-1 text-xs bg-brand-700 hover:bg-brand-800 rounded"
                onClick={() => setShowAddTags(true)}
              >
                <TagIcon className="h-3.5 w-3.5" />
                Add tags
              </button>
            )}
            <button
              className="flex items-center gap-1 px-3 py-1 text-xs bg-red-600 hover:bg-red-700 rounded ml-1"
              onClick={() => setDeleteConfirm(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
          <button
            className="ml-auto text-brand-200 hover:text-white"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="h-4 w-4" />
          </button>
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
                  <Plus className="h-4 w-4" />
                  Add string
                </Button>
              ) : undefined
            }
          />
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
              <tr>
                <th className="w-8 px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide w-40">
                  Key
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide w-52">
                  Source
                </th>
                {targetLocales.map((l) => (
                  <th
                    key={l}
                    className="px-3 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide min-w-[180px]"
                  >
                    {l}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                  Tags / Module
                </th>
                <th className="px-3 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
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
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > search.page_size && (
        <div className="border-t border-slate-200 px-4">
          <Pagination
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
    <span className="flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs">
      {label}
      <button onClick={onRemove} className="hover:text-red-500">
        <X className="h-3 w-3" />
      </button>
    </span>
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
    <tr
      className={cn(
        'transition-colors hover:bg-slate-50/60',
        selected && 'bg-brand-50/40',
      )}
      data-selected={selected}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          className="rounded border-slate-300"
          checked={selected}
          onChange={onToggle}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <span className="font-mono text-xs text-slate-700 break-all">{entry.key}</span>
        {entry.module_slug && (
          <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{entry.module_slug}</p>
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
          variant={allFilled ? 'public' : 'draft'}
          className="mt-1 text-[10px]"
        >
          {allFilled ? 'public' : 'draft'}
        </Badge>
      </td>
      <td className="px-3 py-2 align-top max-w-[220px]">
        <p className="text-sm text-slate-800 leading-relaxed line-clamp-3">{entry.source_text}</p>
        {entry.description && (
          <p className="text-xs text-slate-400 mt-1 italic">{entry.description}</p>
        )}
      </td>
      {targetLocales.map((locale) => (
        <td key={locale} className="px-3 py-2 align-top min-w-[180px]">
          <TranslationCell
            stringId={entry.id}
            projectId={projectId}
            locale={locale}
            translation={translationsByLocale[locale]}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: queryKeys.project(projectId) })
            }}
          />
        </td>
      ))}
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            title="AI Translate"
            onClick={() => onTranslate(entry.id)}
            className="text-slate-400 hover:text-brand-600"
          >
            <Wand2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete"
            onClick={() => deleteMut.mutate()}
            isLoading={deleteMut.isPending}
            className="text-slate-400 hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  )
}

// suppress unused import warning
const _useIsMutating = useIsMutating
