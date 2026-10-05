import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
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
  type ColumnPinningState,
  type PaginationState,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table'
import { ListPlus, Plus, Wand2 } from 'lucide-react'
import { DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/layout/PageHeader'
import { DataTablePagination } from '@/components/data-table/data-table-pagination'
import { DataTableViewOptions } from '@/components/data-table/data-table-view-options'
import { catalogEmptyCopy } from '@/features/strings/batch-filter'
import { useClearStringSelection } from '@/features/strings/selection-reset'
import { BatchActionBar } from '@/features/strings/BatchActionBar'
import { useBatchSelection } from '@/features/strings/use-batch-selection'
import { batchSkippedMessage, type SelectionBatchRequest } from '@/features/strings/batch-selection'
import { BatchMoveDialog, BatchTagDialog } from '@/features/strings/BatchDialogs'
import { AddManyStringsDialog } from '@/features/strings/AddManyStringsDialog'
import { StringsFilters, hasActiveStringFilters } from '@/features/strings/StringsFilters'
import {
  catalogSortChanged,
  catalogSortSearchUpdates,
  sortingStateFromSearch,
} from '@/features/strings/catalog-sort'
import type { CatalogSortField } from '@/features/strings/catalog-sort'
import { getStringColumns } from '@/features/strings/string-columns'
import { releaseRowClassName, releaseState } from '@/features/strings/working-copy'
import {
  TranslateReviewDialog,
  jobStillRunning,
  proposalsFromJobResult,
} from '@/features/strings/TranslateReviewDialog'
import { PublishPreviewDialog } from '@/features/strings/PublishPreviewDialog'
import {
  buildPublishPreview,
  isPublishFingerprintMismatch,
  publishConfirmRequest,
  reviewPublishSource,
  searchToBatchFilter,
} from '@/features/strings/publish-preview'
import {
  batchSuccessMessage,
  unpublishConfirmCopy,
} from '@/features/strings/batch-feedback'
import {
  TRANSLATE_MISSING_PAGE_SIZE,
  applyPayloadFromDrafts,
  applySuccessMessage,
  createMissingReviewRequest,
  descriptionsFromDrafts,
  filledStringCount,
  mergeProposalResults,
  type MissingReviewRequest,
} from '@/features/strings/translate-review'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { jobsApi } from '@/lib/api/jobs'
import { ApiError } from '@/lib/api/client'
import { stringsApi } from '@/lib/api/strings'
import type {
  BatchAction,
  PublishPreviewRequest,
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

const stringsRoute = getRouteApi('/projects/$projectRef/strings')

const STRING_COLUMN_PINNING: ColumnPinningState = {
  left: ['select', 'key'],
  right: ['actions'],
}

export function StringsPage() {
  const { projectRef: projectId } = stringsRoute.useParams()
  const rawSearch = stringsRoute.useSearch()
  const search = resolveStringsSearch(rawSearch)
  const navigate = useNavigate({ from: '/projects/$projectRef/strings' })
  const [, startTransition] = useTransition()
  const qc = useQueryClient()
  const toast = useToast()

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    created_at: false,
    created_by_label: false,
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [addManyOpen, setAddManyOpen] = useState(false)
  const [dialogEntry, setDialogEntry] = useState<StringEntry | null>(null)
  const [dialogTab, setDialogTab] = useState<'details' | 'history'>('details')
  const [restoreLastConfirm, setRestoreLastConfirm] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const reviewRequestRef = useRef<MissingReviewRequest | null>(null)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewPageSize, setReviewPageSize] = useState(TRANSLATE_MISSING_PAGE_SIZE)
  const [reviewTotal, setReviewTotal] = useState(0)
  const [proposalJobId, setProposalJobId] = useState<string | null>(null)
  const [proposalItems, setProposalItems] = useState<TranslateProposalItem[]>([])
  const [proposalsReady, setProposalsReady] = useState(false)
  const [showMoveModule, setShowMoveModule] = useState(false)
  const [showAddTags, setShowAddTags] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [unpublishConfirm, setUnpublishConfirm] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishEntries, setPublishEntries] = useState<StringEntry[] | null>(null)
  const [publishFingerprint, setPublishFingerprint] = useState<string | null>(null)
  const publishRequestRef = useRef<PublishPreviewRequest | null>(null)
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
  const catalogSortSearch = useMemo(
    () => ({ sort: rawSearch.sort, order: rawSearch.order }),
    [rawSearch.sort, rawSearch.order],
  )
  const sorting = useMemo(() => sortingStateFromSearch(catalogSortSearch), [catalogSortSearch])

  const handleCatalogSortToggle = useCallback(
    (columnId: CatalogSortField) => {
      const updates = catalogSortSearchUpdates(catalogSortSearch, columnId)
      const sortChanged = catalogSortChanged(catalogSortSearch, updates)
      startTransition(() => {
        navigate({
          search: (prev) => ({
            ...prev,
            ...updates,
            page: sortChanged ? 1 : prev.page,
          }),
        })
      })
    },
    [catalogSortSearch, navigate],
  )

  useEffect(() => {
    if (!stringsResult.isError) return
    const err = stringsResult.error
    if (!(err instanceof ApiError) || err.status !== 400) return
    if (!rawSearch.sort && !rawSearch.order) return
    toast.error(err.message)
    startTransition(() => {
      navigate({
        search: (prev) => ({
          ...prev,
          sort: undefined,
          order: undefined,
        }),
      })
    })
  }, [stringsResult.isError, stringsResult.error, rawSearch.sort, rawSearch.order, navigate, toast])
  const { data: modules = [] } = useQuery(modulesQuery(projectId))
  const { data: tags = [] } = useQuery(tagsQuery(projectId))
  const { data: project } = useQuery(projectQuery(projectId))
  const locales = useMemo(() => project?.target_languages ?? [], [project?.target_languages])

  function missingRequest(page: number): TranslateRequest {
    const request = reviewRequestRef.current
    if (!request) throw new Error('Translation review session is not open')
    return { ...request, page }
  }

  const invalidateStrings = useCallback(() => {
    qc.invalidateQueries({ queryKey: queryKeys.projects.strings.all(projectId) })
    qc.invalidateQueries({ queryKey: queryKeys.projects.activities.all(projectId) })
  }, [qc, projectId])

  const previewMut = useMutation({
    mutationFn: (body: PublishPreviewRequest) => stringsApi.publishPreview(projectId, body),
    onSuccess: (res) => {
      setPublishEntries(res.items)
      setPublishFingerprint(res.fingerprint)
    },
    onError: () => {
      toast.error('Failed to load publish preview')
      setPublishOpen(false)
      setPublishEntries(null)
      setPublishFingerprint(null)
      publishRequestRef.current = null
    },
  })

  const batchMut = useMutation({
    mutationFn: ({ request }: SelectionBatchRequest) => stringsApi.batch(projectId, request),
    onSuccess: (data, { request: req, selectedCount }) => {
      invalidateStrings()
      setRowSelection({})
      setShowMoveModule(false)
      setShowAddTags(false)
      setDeleteConfirm(false)
      setRestoreLastConfirm(false)
      setUnpublishConfirm(false)
      if (req.action === 'publish') {
        setPublishOpen(false)
        setPublishEntries(null)
        setPublishFingerprint(null)
        publishRequestRef.current = null
      }
      const message = batchSuccessMessage(req.action, data.affected, selectedCount)
      if (message) toast.success(message)
    },
    onError: (e, { request: req }) => {
      if (req.action === 'publish' && isPublishFingerprintMismatch(e)) {
        const body = publishRequestRef.current
        if (body) {
          setPublishEntries(null)
          setPublishFingerprint(null)
          previewMut.mutate(body)
        }
        toast.info('Working copy changed. Review the updated preview.')
        return
      }
      toast.error(e instanceof Error ? e.message : 'Batch action failed')
    },
  })

  const missingMut = useMutation({
    mutationFn: (req: TranslateRequest) => stringsApi.translateMissing(projectId, req),
    onSuccess: (res) => {
      setProposalItems(res.items)
      setReviewTotal(res.total)
      setReviewPage(res.page)
      setReviewPageSize(res.page_size)
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
      setProposalItems((prev) => mergeProposalResults(prev, res.items))
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
      setProposalItems((prev) => mergeProposalResults(prev, proposalsFromJobResult(job.result)))
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
        items: applyPayloadFromDrafts(items),
      }),
    onSuccess: (res, items) => {
      toast.success(applySuccessMessage(res.translated_count, filledStringCount(items)))
      setProposalJobId(null)
      setProposalsReady(false)
      proposeMut.reset()
      invalidateStrings()
      missingMut.mutate(missingRequest(reviewPage))
    },
    onError: () => toast.error('Failed to save translations'),
  })

  function closeReview() {
    if (applyMut.isPending || proposeMut.isPending) return
    setReviewOpen(false)
    reviewRequestRef.current = null
    setProposalJobId(null)
    setProposalsReady(false)
    proposeMut.reset()
  }

  function loadMissingPage(page: number) {
    if (!reviewRequestRef.current || applyMut.isPending || proposeMut.isPending || Boolean(proposalJobId)) return
    setProposalJobId(null)
    missingMut.mutate(missingRequest(page))
  }

  const loadPublishPreview = previewMut.mutate
  const requestPublishPreview = useCallback(
    (body: PublishPreviewRequest) => {
      publishRequestRef.current = body
      setPublishFingerprint(null)
      setPublishEntries(null)
      setPublishOpen(true)
      loadPublishPreview(body)
    },
    [loadPublishPreview],
  )

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
  const reviewItems = proposalItems
  const reviewGenerating =
    proposeMut.isPending ||
    (Boolean(proposalJobId) && jobStillRunning(proposalJobQuery.data))
  const reviewError =
    missingMut.error instanceof Error
      ? missingMut.error.message
      : proposeMut.error instanceof Error
        ? proposeMut.error.message
        : proposalJobQuery.data?.status === 'failed'
          ? proposalJobQuery.data.error ?? 'Translation job failed'
          : null
  const hasActiveFilters = hasActiveStringFilters(search)
  const emptyCopy = catalogEmptyCopy(Boolean(search.batch_id), hasActiveFilters)

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
      onPublishPreview: (entry: StringEntry) => requestPublishPreview({ string_ids: [entry.id] }),
      catalogSort: catalogSortSearch,
      onCatalogSortToggle: handleCatalogSortToggle,
    }),
    [
      projectId,
      openEditor,
      requestPublishPreview,
      invalidateStrings,
      catalogSortSearch,
      handleCatalogSortToggle,
    ],
  )

  const catalogSortListError =
    stringsResult.isError &&
    stringsResult.error instanceof ApiError &&
    stringsResult.error.status === 400 &&
    Boolean(rawSearch.sort || rawSearch.order)

  const catalogRefetchingEmpty =
    stringsResult.isFetching &&
    !stringsResult.isLoading &&
    data.length === 0 &&
    !search.batch_id

  const table = useReactTable({
    data,
    columns,
    state: { pagination, rowSelection, columnVisibility, sorting },
    initialState: { columnPinning: STRING_COLUMN_PINNING },
    enableColumnPinning: true,
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
    enableSorting: true,
    enableMultiSort: false,
    manualSorting: true,
    enableRowSelection: true,
    manualPagination: true,
    autoResetPageIndex: false,
    pageCount: Math.max(1, Math.ceil(total / search.page_size) || 1),
    rowCount: total,
    meta: tableMeta,
  })

  const selection = useBatchSelection(projectId, rowSelection, data)
  const selectedList = selection.ids
  const selectedCount = selectedList.length
  const selectedEntries = selection.entries
  const actionIds = selection.actions

  function runSelectedAction(action: BatchAction, payload?: Record<string, unknown>) {
    if (!selection.ready || batchMut.isPending || actionIds[action].length === 0) return
    batchMut.mutate({
      request: { action, string_ids: actionIds[action], payload },
      selectedCount,
    })
  }

  useEffect(() => {
    if (selectedCount === 0) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (event.defaultPrevented) return
      if (document.querySelector('[data-slot="alert-dialog-content"], [data-slot="dialog-content"]')) return
      if (
        dialogOpen ||
        reviewOpen ||
        publishOpen ||
        showMoveModule ||
        showAddTags ||
        deleteConfirm ||
        unpublishConfirm
      ) return
      setRowSelection({})
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedCount, dialogOpen, reviewOpen, publishOpen, showMoveModule, showAddTags, deleteConfirm, unpublishConfirm])

  useClearStringSelection(search, setRowSelection)

  const unpublishCopy = unpublishConfirmCopy(actionIds.unpublish.length, selectedCount)
  const selectedReleased = selectedEntries.some(
    (entry) => actionIds.delete.includes(entry.id) && (entry.status === 'public' || entry.published_at),
  )
  const publishPreview = useMemo(
    () => (publishEntries ? buildPublishPreview(publishEntries) : null),
    [publishEntries],
  )

  function openReviewPublishPreview() {
    if (selectedCount > 0) {
      requestPublishPreview({ string_ids: selectedList })
      return
    }
    const source = reviewPublishSource([], searchToBatchFilter(search))
    if ('entries' in source) {
      requestPublishPreview({ string_ids: source.entries.map((entry) => entry.id) })
      return
    }
    requestPublishPreview({ filter: source.filter })
  }

  function openSelectedPublishPreview() {
    requestPublishPreview({ string_ids: selectedList })
  }

  function closePublishPreview() {
    if (batchMut.isPending || previewMut.isPending) return
    setPublishOpen(false)
    setPublishEntries(null)
    setPublishFingerprint(null)
    publishRequestRef.current = null
  }

  function confirmPublishPreview() {
    if (!publishPreview || !publishFingerprint || publishPreview.publishableIds.length === 0) return
    batchMut.mutate({
      request: publishConfirmRequest(publishPreview.publishableIds, publishFingerprint),
      selectedCount: publishEntries?.length ?? publishPreview.publishableIds.length,
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col gap-5 border-b px-4 py-5 sm:px-6">
        <PageHeader
          title="Strings"
          description={`${total} string${total === 1 ? '' : 's'} · ${locales.length} target language${locales.length === 1 ? '' : 's'}`}
          actions={
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <DataTableViewOptions table={table} />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  reviewRequestRef.current = createMissingReviewRequest(search, locales)
                  setProposalItems([])
                  setProposalJobId(null)
                  setProposalsReady(false)
                  setReviewPage(1)
                  setReviewTotal(0)
                  setReviewOpen(true)
                  missingMut.mutate(missingRequest(1))
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
              <Button size="sm" variant="outline" onClick={() => setAddManyOpen(true)}>
                <ListPlus data-icon="inline-start" />
                Add many
              </Button>
              <Button size="sm" onClick={() => openEditor(null)}>
                <Plus data-icon="inline-start" />
                Add string
              </Button>
            </div>
          }
        />
        <StringsFilters
          search={search}
          searchInput={searchInput}
          modules={modules}
          tags={tags}
          locales={locales}
          onSearchInputChange={setSearchInput}
          onFilter={setFilter}
          onReviewPublish={
            search.has_unpublished_changes ? openReviewPublishPreview : undefined
          }
          onClear={() => {
            setSearchInput('')
            navigate({
              search: {
                page: 1,
                page_size: search.page_size,
                sort: rawSearch.sort,
                order: rawSearch.order,
              },
            })
          }}
        />
      </div>

      <div className="min-h-0 flex-1 bg-card">
        {stringsResult.isLoading || catalogSortListError || catalogRefetchingEmpty ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        ) : stringsResult.isError ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Failed to load strings.
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            title={emptyCopy.title}
            description={emptyCopy.description}
            action={
              !hasActiveFilters ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="outline" onClick={() => setAddManyOpen(true)}>
                    <ListPlus data-icon="inline-start" />
                    Add many
                  </Button>
                  <Button onClick={() => openEditor(null)}>
                    <Plus data-icon="inline-start" />
                    Add string
                  </Button>
                </div>
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
              selectedCount > 0 ? (
                <BatchActionBar
                  selectedCount={selectedCount}
                  visible={selectedCount > 0}
                  pending={batchMut.isPending}
                  actions={actionIds}
                  checking={selection.checking}
                  selectionError={selection.error}
                  onRetry={() => { void selection.retry() }}
                  modules={modules}
                  tags={tags}
                  onPublish={() => openSelectedPublishPreview()}
                  onUnpublish={() => setUnpublishConfirm(true)}
                  onMove={() => setShowMoveModule(true)}
                  onAddTags={() => setShowAddTags(true)}
                  onDelete={() => setDeleteConfirm(true)}
                  onDiscardChanges={() => runSelectedAction('discard_changes')}
                  onDiscardDelete={() => runSelectedAction('discard_delete')}
                  onRestore={() => runSelectedAction('restore')}
                  onRestoreLastEdit={() => setRestoreLastConfirm(true)}
                  onClear={() => setRowSelection({})}
                />
              ) : undefined
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

      <AddManyStringsDialog
        open={addManyOpen}
        projectId={projectId}
        project={project}
        modules={modules}
        tags={tags}
        onClose={() => setAddManyOpen(false)}
        onSuccess={() => {
          setAddManyOpen(false)
          invalidateStrings()
        }}
      />

      <TranslateReviewDialog
        open={reviewOpen}
        loadingQueue={missingMut.isPending}
        generating={reviewGenerating}
        applying={applyMut.isPending}
        generated={proposalsReady}
        error={reviewError}
        items={reviewItems}
        page={reviewPage}
        pageSize={reviewPageSize}
        total={reviewTotal}
        progress={proposalJobQuery.data?.progress}
        onPageChange={loadMissingPage}
        onClose={closeReview}
        onTranslate={(items) => {
          proposeMut.mutate({
            scope: 'strings',
            string_ids: items.map((item) => item.string_id),
            locales,
            descriptions: descriptionsFromDrafts(items),
          })
        }}
        onApply={(items) => applyMut.mutate(items)}
      />

      <PublishPreviewDialog
        open={publishOpen}
        preview={publishPreview}
        loading={previewMut.isPending && publishEntries == null}
        confirming={batchMut.isPending && publishOpen}
        onClose={closePublishPreview}
        onConfirm={confirmPublishPreview}
      />

      <BatchMoveDialog
        open={showMoveModule}
        onClose={() => setShowMoveModule(false)}
        modules={modules}
        onSelect={(moduleId) =>
          runSelectedAction('move_module', { module_id: moduleId })
        }
        isLoading={batchMut.isPending}
      />

      <BatchTagDialog
        open={showAddTags}
        onClose={() => setShowAddTags(false)}
        tags={tags}
        onApply={(tagIds) =>
          runSelectedAction('add_tags', { tag_ids: tagIds })
        }
        isLoading={batchMut.isPending}
      />

      <ConfirmDialog
        open={unpublishConfirm}
        onClose={() => setUnpublishConfirm(false)}
        onConfirm={() =>
          runSelectedAction('unpublish')
        }
        title={unpublishCopy.title}
        description={unpublishCopy.description}
        confirmLabel={unpublishCopy.confirmLabel}
        confirmDisabled={!selection.ready || actionIds.unpublish.length === 0}
        variant="default"
        isLoading={batchMut.isPending}
      />

      <ConfirmDialog
        open={deleteConfirm}
        onClose={() => setDeleteConfirm(false)}
        onConfirm={() =>
          runSelectedAction('delete')
        }
        title={`Delete ${actionIds.delete.length} string${actionIds.delete.length === 1 ? '' : 's'}?`}
        description={
          (selectedReleased
            ? 'Published strings stay on prod until you publish the removal. Staging draft pull hides pending deletes. Never-published strings are hidden and can be restored from Deleted.'
            : 'Strings are hidden from the grid. Restore them from the Deleted filter.') +
          ' ' + batchSkippedMessage(selectedCount, actionIds.delete.length, true)
        }
        confirmLabel="Delete"
        confirmDisabled={!selection.ready || actionIds.delete.length === 0}
        isLoading={batchMut.isPending}
      />

      <ConfirmDialog
        open={restoreLastConfirm}
        onClose={() => setRestoreLastConfirm(false)}
        onConfirm={() =>
          runSelectedAction('restore_last_history')
        }
        title="Restore last edit?"
        description={`Restore the previous working copy for up to ${actionIds.restore_last_history.length} selected string${actionIds.restore_last_history.length === 1 ? '' : 's'}. Strings without edit history are skipped. Production snapshots are unchanged. ${batchSkippedMessage(selectedCount, actionIds.restore_last_history.length, true)}`}
        confirmLabel="Restore last edit"
        confirmDisabled={!selection.ready || actionIds.restore_last_history.length === 0}
        isLoading={batchMut.isPending}
      />
    </div>
  )
}
