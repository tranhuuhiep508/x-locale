import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  useTransition,
  lazy,
  Suspense,
} from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getCoreRowModel,
  useReactTable,
  type PaginationState,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table'
import { Plus, Wand2 } from 'lucide-react'
import { DataTable } from '@/components/data-table/data-table'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { DataTableViewOptions } from '@/components/data-table/data-table-view-options'
import { BatchActionBar } from '@/features/strings/BatchActionBar'
import { BatchMoveDialog, BatchTagDialog } from '@/features/strings/BatchDialogs'
import { StringsFilters, hasActiveStringFilters } from '@/features/strings/StringsFilters'
import { getStringColumns } from '@/features/strings/string-columns'
import { canDiscardWorkingCopy, releaseRowClassName, releaseState } from '@/features/strings/working-copy'
import {
  TranslateReviewDialog,
  jobStillRunning,
  proposalsFromJobResult,
} from '@/features/strings/TranslateReviewDialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { jobsApi } from '@/lib/api/jobs'
import { stringsApi } from '@/lib/api/strings'
import type {
  BatchRequest,
  StringEntry,
  TranslateProposalItem,
  TranslateRequest,
} from '@/lib/api/types'
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

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    created_at: false,
    created_by_label: false,
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogEntry, setDialogEntry] = useState<StringEntry | null>(null)
  const [dialogTab, setDialogTab] = useState<'details' | 'history'>('details')
  const [restoreLastConfirm, setRestoreLastConfirm] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [proposalJobId, setProposalJobId] = useState<string | null>(null)
  const [proposalItems, setProposalItems] = useState<TranslateProposalItem[]>([])
  const [proposalsReady, setProposalsReady] = useState(false)
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
      setRowSelection({})
      setShowMoveModule(false)
      setShowAddTags(false)
      setDeleteConfirm(false)
      setRestoreLastConfirm(false)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Batch action failed'),
  })

  const missingMut = useMutation({
    mutationFn: (req: TranslateRequest) => stringsApi.translateMissing(projectId, req),
    onSuccess: (res) => {
      setProposalItems(res.items)
      setProposalsReady(false)
    },
    onError: () => toast.error('Failed to load missing translations'),
  })

  const proposeMut = useMutation({
    mutationFn: (req: TranslateRequest) => stringsApi.translateProposals(projectId, req),
    onSuccess: (res) => {
      if (res.job_id) {
        setProposalJobId(res.job_id)
        return
      }
      setProposalItems(res.items)
      setProposalsReady(true)
    },
    onError: () => toast.error('Translation failed — check Bedrock credentials'),
  })

  const previewItemsMut = useMutation({
    mutationFn: async (items: TranslateProposalItem[]) => {
      const next = await Promise.all(
        items.map(async (item) => {
          const locales = Object.keys(item.translations)
          if (locales.length === 0) return item
          const res = await stringsApi.translatePreview(projectId, {
            source_text: item.source_text,
            description: item.description?.trim() || undefined,
            locales,
          })
          const translations = { ...item.translations }
          const scores = { ...(item.scores ?? {}) }
          for (const locale of locales) {
            const value = res.translations[locale]
            if (!value?.trim()) continue
            translations[locale] = value
            const score = res.scores?.[locale]
            if (typeof score === 'number') scores[locale] = score
            else delete scores[locale]
          }
          return { ...item, translations, scores }
        }),
      )
      return next
    },
    onSuccess: (items) => {
      setProposalItems(items)
      setProposalsReady(true)
    },
    onError: () => toast.error('Translation failed — check Bedrock credentials'),
  })

  const proposalJobQuery = useQuery({
    queryKey: queryKeys.jobs.detail(proposalJobId ?? ''),
    queryFn: () => jobsApi.get(proposalJobId!),
    enabled: Boolean(proposalJobId),
    refetchInterval: (query) =>
      jobStillRunning(query.state.data) ? 1000 : false,
  })

  const acceptJobResult = useEffectEvent((job: NonNullable<typeof proposalJobQuery.data>) => {
    if (job.status === 'completed') {
      setProposalItems(proposalsFromJobResult(job.result))
      setProposalsReady(true)
      setProposalJobId(null)
    }
  })

  useEffect(() => {
    const job = proposalJobQuery.data
    if (!proposalJobId || !job) return
    if (job.status === 'completed') acceptJobResult(job)
  }, [proposalJobId, proposalJobQuery.data])

  const applyMut = useMutation({
    mutationFn: (items: TranslateProposalItem[]) =>
      stringsApi.translateApply(projectId, {
        items: items.map((item) => ({
          string_id: item.string_id,
          translations: item.translations,
          scores: item.scores,
          description: item.description ?? '',
        })),
      }),
    onSuccess: (res) => {
      toast.success(`Filled ${res.translated_count} empty translation(s)`)
      setReviewOpen(false)
      setProposalJobId(null)
      setProposalItems([])
      setProposalsReady(false)
      proposeMut.reset()
      missingMut.reset()
      previewItemsMut.reset()
      invalidateStrings()
    },
    onError: () => toast.error('Failed to save translations'),
  })

  function closeReview() {
    if (applyMut.isPending || proposeMut.isPending || previewItemsMut.isPending) return
    setReviewOpen(false)
    setProposalJobId(null)
    setProposalItems([])
    setProposalsReady(false)
    proposeMut.reset()
    missingMut.reset()
    previewItemsMut.reset()
  }

  const openEditor = useCallback((entry: StringEntry | null, tab: 'details' | 'history' = 'details') => {
    setDialogEntry(entry)
    setDialogTab(tab)
    setDialogOpen(true)
  }, [])

  function setFilter(updates: Partial<StringsSearch>) {
    startTransition(() => {
      navigate({ search: (prev) => ({ ...prev, ...updates, page: 1 }) })
    })
  }

  const strings = stringsResult.data?.items
  const data = useMemo(() => strings ?? [], [strings])
  const total = stringsResult.data?.total ?? 0
  const targetLocales = project?.target_languages
  const locales = useMemo(() => targetLocales ?? [], [targetLocales])
  const reviewItems = proposalItems
  const reviewGenerating =
    proposeMut.isPending ||
    previewItemsMut.isPending ||
    (Boolean(proposalJobId) && jobStillRunning(proposalJobQuery.data))
  const reviewError =
    missingMut.error instanceof Error
      ? missingMut.error.message
      : proposeMut.error instanceof Error
        ? proposeMut.error.message
        : previewItemsMut.error instanceof Error
          ? previewItemsMut.error.message
          : proposalJobQuery.data?.status === 'failed'
            ? proposalJobQuery.data.error ?? 'Translation job failed'
            : null
  const hasActiveFilters = hasActiveStringFilters(search)

  const columns = useMemo(() => getStringColumns(locales), [locales])
  const pagination = useMemo<PaginationState>(
    () => ({ pageIndex: search.page - 1, pageSize: search.page_size }),
    [search.page, search.page_size],
  )
  const tableMeta = useMemo(
    () => ({
      projectId,
      onEdit: (entry: StringEntry) => openEditor(entry),
      onHistory: (entry: StringEntry) => openEditor(entry, 'history'),
      onRefresh: invalidateStrings,
    }),
    [projectId, openEditor, invalidateStrings],
  )

  const table = useReactTable({
    data,
    columns,
    state: { pagination, rowSelection, columnVisibility },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: (updater) => {
      const next = typeof updater === 'function' ? updater(pagination) : updater
      startTransition(() => {
        navigate({
          search: (prev) => ({
            ...prev,
            page: next.pageIndex + 1,
            page_size: next.pageSize,
          }),
        })
      })
    },
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    enableSorting: false,
    enableRowSelection: true,
    manualPagination: true,
    autoResetPageIndex: false,
    pageCount: Math.max(1, Math.ceil(total / search.page_size) || 1),
    rowCount: total,
    meta: tableMeta,
  })

  const selectedList = Object.keys(rowSelection).filter((id) => rowSelection[id])
  const selectedCount = selectedList.length
  const selectedEntries = data.filter((entry) => rowSelection[entry.id])

  useEffect(() => {
    if (selectedCount === 0) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      if (document.querySelector('[data-slot="alert-dialog-content"], [data-slot="dialog-content"]')) return
      if (dialogOpen || reviewOpen || showMoveModule || showAddTags || deleteConfirm) return
      setRowSelection({})
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedCount, dialogOpen, reviewOpen, showMoveModule, showAddTags, deleteConfirm])

  const showDiscardChanges = selectedEntries.some(canDiscardWorkingCopy)
  const showDiscardDelete = selectedEntries.some((entry) => entry.pending_delete)
  const showRestore = selectedEntries.some((entry) => Boolean(entry.deleted_at))
  const selectedReleased = selectedEntries.some(
    (entry) => entry.status === 'public' || entry.published_at,
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 px-5 py-3">
        <StringsFilters
          search={search}
          searchInput={searchInput}
          modules={modules}
          tags={tags}
          locales={locales}
          onSearchInputChange={setSearchInput}
          onFilter={setFilter}
          onClear={() => {
            setSearchInput('')
            navigate({
              search: { page: 1, page_size: search.page_size },
            })
          }}
          actions={
            <>
              <DataTableViewOptions table={table} />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setProposalItems([])
                  setProposalJobId(null)
                  setProposalsReady(false)
                  setReviewOpen(true)
                  missingMut.mutate({ scope: 'missing', locales })
                }}
                disabled={missingMut.isPending || reviewOpen}
              >
                {missingMut.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Wand2 data-icon="inline-start" />
                )}
                Translate missing
              </Button>
              <Button size="sm" onClick={() => openEditor(null)}>
                <Plus data-icon="inline-start" />
                Add string
              </Button>
            </>
          }
        />
      </div>

      <div className="min-h-0 flex-1">
        {stringsResult.isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        ) : data.length === 0 ? (
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
                  onClick={() => openEditor(null)}
                >
                  <Plus data-icon="inline-start" />
                  Add string
                </Button>
              ) : undefined
            }
          />
        ) : (
          <DataTable
            table={table}
            getRowClassName={(row) => releaseRowClassName(releaseState(row.original))}
            onRowClick={(row, event) => {
              const target = event.target as HTMLElement
              if (target.closest('button, input, [role="checkbox"], [role="switch"], [role="radio"], [role="menuitem"], a')) return
              openEditor(row.original)
            }}
          />
        )}
      </div>

      {total > 0 ? (
        <div className="shrink-0 border-t px-4">
          <DataTablePagination
            table={table}
            center={
              <BatchActionBar
                selectedCount={selectedCount}
                visible={selectedCount > 0}
                pending={batchMut.isPending}
                modules={modules}
                tags={tags}
                onPublish={() => batchMut.mutate({ action: 'publish', string_ids: selectedList })}
                onUnpublish={() => batchMut.mutate({ action: 'unpublish', string_ids: selectedList })}
                onMove={() => setShowMoveModule(true)}
                onAddTags={() => setShowAddTags(true)}
                onDelete={() => setDeleteConfirm(true)}
                onDiscardChanges={() =>
                  batchMut.mutate({ action: 'discard_changes', string_ids: selectedList })
                }
                onDiscardDelete={() =>
                  batchMut.mutate({ action: 'discard_delete', string_ids: selectedList })
                }
                onRestore={() => batchMut.mutate({ action: 'restore', string_ids: selectedList })}
                onRestoreLastEdit={() => setRestoreLastConfirm(true)}
                showDiscardChanges={showDiscardChanges}
                showDiscardDelete={showDiscardDelete}
                showRestore={showRestore}
                showRestoreLastEdit={!showRestore}
                onClear={() => setRowSelection({})}
              />
            }
          />
        </div>
      ) : null}

      {dialogOpen && (
        <Suspense fallback={null}>
          <StringFormDialog
            key={`${dialogEntry?.id ?? 'new'}-${dialogTab}`}
            projectId={projectId}
            entry={dialogEntry}
            modules={modules}
            tags={tags}
            targetLocales={locales}
            onClose={() => {
              setDialogOpen(false)
              setDialogEntry(null)
              setDialogTab('details')
            }}
            initialTab={dialogTab}
            onSuccess={() => {
              setDialogOpen(false)
              setDialogEntry(null)
              invalidateStrings()
            }}
          />
        </Suspense>
      )}

      <TranslateReviewDialog
        open={reviewOpen}
        loadingQueue={missingMut.isPending}
        generating={reviewGenerating}
        applying={applyMut.isPending}
        generated={proposalsReady}
        error={reviewError}
        items={reviewItems}
        onClose={closeReview}
        onTranslate={(items) => {
          if (proposalsReady || items.length === 1) {
            previewItemsMut.mutate(items)
            return
          }
          proposeMut.mutate({ scope: 'missing', locales })
        }}
        onApply={(items) => applyMut.mutate(items)}
      />

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
        title={`Delete ${selectedCount} string${selectedCount > 1 ? 's' : ''}?`}
        description={
          selectedReleased
            ? 'Published strings stay on prod until you publish the removal. Staging draft pull hides pending deletes. Never-published strings are hidden and can be restored from Deleted.'
            : 'Strings are hidden from the grid. Restore them from the Deleted filter.'
        }
        confirmLabel="Delete"
        isLoading={batchMut.isPending}
      />

      <ConfirmDialog
        open={restoreLastConfirm}
        onClose={() => setRestoreLastConfirm(false)}
        onConfirm={() =>
          batchMut.mutate({ action: 'restore_last_history', string_ids: selectedList })
        }
        title="Restore last edit?"
        description={`This restores the previous working copy for ${selectedCount} selected string${selectedCount === 1 ? '' : 's'}. Production snapshots are unchanged.`}
        confirmLabel="Restore last edit"
        isLoading={batchMut.isPending}
      />
    </div>
  )
}
