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
import { AlignLeft, ChevronDown, ListPlus, Plus, Rows3, Rows4, SearchX, Wand2 } from 'lucide-react'
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
  publicationErrorMessage,
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
  sourceConflicts,
  createMissingReviewRequest,
  excludedMemoryCells,
  mergeProposalResults,
  reviewedPayloadFromDrafts,
  saveSuccessMessage,
  valueConflictMessage,
  valueConflicts,
  type MissingReviewRequest,
} from '@/features/strings/translate-review'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { jobsApi } from '@/lib/api/jobs'
import { ApiError } from '@/lib/api/client'
import { stringsApi } from '@/lib/api/strings'
import type {
  BatchAction,
  PublishPreviewRequest,
  StringEntry,
  TranslateProposalItem,
  TranslateRequest,
  TranslateReview,
  TranslateSaveRequest,
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

type ReviewPayload = TranslateSaveRequest['items']
type SaveVariables = {
  action: TranslateSaveRequest['action']
  payload: ReviewPayload
  fingerprint?: string
  items?: TranslateProposalItem[]
}

const STRING_COLUMN_PINNING: ColumnPinningState = {
  left: ['select', 'key'],
  right: ['actions'],
}

const DENSITY_STORAGE_KEY = 'x-locale:strings-density'
type TableDensity = 'comfortable' | 'compact'

function readStoredDensity(): TableDensity {
  try {
    return window.localStorage.getItem(DENSITY_STORAGE_KEY) === 'compact'
      ? 'compact'
      : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

function StringsTableSkeleton({ localeCount }: { localeCount: number }) {
  const cols = Math.max(1, Math.min(localeCount, 3))
  return (
    <div
      role="status"
      aria-label="Loading strings"
      className="flex h-full flex-col overflow-hidden bg-card"
    >
      <div className="flex items-center gap-4 border-b border-border/80 bg-muted px-4 py-2.5">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3.5 w-40" />
        {Array.from({ length: cols }).map((_, idx) => (
          <Skeleton key={idx} className="hidden h-3.5 w-24 sm:block" />
        ))}
        <Skeleton className="ml-auto h-3.5 w-16" />
      </div>
      <div className="divide-y divide-border/65">
        {Array.from({ length: 8 }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="size-4 shrink-0 rounded" />
            <div className="flex w-44 shrink-0 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            {Array.from({ length: cols }).map((_, colIdx) => (
              <Skeleton key={colIdx} className="hidden h-3.5 w-28 sm:block" />
            ))}
            <Skeleton className="ml-auto h-5 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

function AddStringMenu({
  size = 'sm',
  align = 'end',
  className,
  onAddSingle,
  onAddMany,
}: {
  size?: 'sm' | 'default'
  align?: 'center' | 'end'
  className?: string
  onAddSingle: () => void
  onAddMany: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size={size} className={className} aria-haspopup="menu" aria-expanded={open}>
          <Plus data-icon="inline-start" className={size === 'sm' ? 'size-3.5' : undefined} />
          Add string
          <ChevronDown data-icon="inline-end" className="size-3.5 opacity-80" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-56 p-1">
        <div role="menu" aria-label="Add string options" className="flex flex-col gap-0.5">
          <button
            type="button"
            role="menuitem"
            aria-label="Add single string"
            onClick={() => {
              setOpen(false)
              onAddSingle()
            }}
            className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-hidden"
          >
            <Plus className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium leading-tight">Add single string</span>
              <span className="text-xs text-muted-foreground">Key, context &amp; translations</span>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            aria-label="Add many"
            onClick={() => {
              setOpen(false)
              onAddMany()
            }}
            className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-hidden"
          >
            <ListPlus className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium leading-tight">Add many</span>
              <span className="text-xs text-muted-foreground">Paste JSON or CSV lines</span>
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
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
  const savedRow = useRef<HTMLTableRowElement>(null)
  const pendingSavedFocus = useRef<string | null>(null)
  const [restoreLastConfirm, setRestoreLastConfirm] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const reviewRequestRef = useRef<MissingReviewRequest | null>(null)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewPageSize, setReviewPageSize] = useState(TRANSLATE_MISSING_PAGE_SIZE)
  const [reviewTotal, setReviewTotal] = useState(0)
  const [proposalJobId, setProposalJobId] = useState<string | null>(null)
  const [proposalItems, setProposalItems] = useState<TranslateProposalItem[]>([])
  const [applySourceConflicts, setApplySourceConflicts] = useState<ReturnType<typeof sourceConflicts>>([])
  const regenerationIds = useRef<string[] | null>(null)
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null)
  const [proposalsReady, setProposalsReady] = useState(false)
  // Frozen publication review: exactly these rows publish, against this fingerprint.
  const [publishReview, setPublishReview] = useState<{
    payload: ReviewPayload
    review: TranslateReview | null
  } | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const refreshingAfterSave = useRef(false)
  const [showMoveModule, setShowMoveModule] = useState(false)
  const [showAddTags, setShowAddTags] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [unpublishConfirm, setUnpublishConfirm] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishEntries, setPublishEntries] = useState<StringEntry[] | null>(null)
  const [publishFingerprint, setPublishFingerprint] = useState<string | null>(null)
  const publishRequestRef = useRef<PublishPreviewRequest | null>(null)
  const [searchInput, setSearchInput] = useState(search.q ?? '')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [density, setDensity] = useState<TableDensity>(readStoredDensity)

  function updateDensity(next: TableDensity) {
    setDensity(next)
    try {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, next)
    } catch {
      // Ignore storage errors in restricted environments
    }
  }

  useEffect(() => {
    setSearchInput(search.q ?? '')
  }, [search.q])

  const applySearchQ = useEffectEvent((value: string) => {
    startTransition(() => {
      navigate({
        search: (prev) => ({
          ...prev,
          q: value || undefined,
          saved_string: undefined,
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
  const pendingStringsResult = useQuery(
    stringsQueryOptions(projectId, { has_unpublished_changes: true, page: 1, page_size: 1 }),
  )
  const pendingCount = pendingStringsResult.data?.total ?? 0
  useEffect(() => {
    const row = savedRow.current
    if (dialogOpen || !row || pendingSavedFocus.current !== search.saved_string) return
    pendingSavedFocus.current = null
    row.focus({ preventScroll: true })
    row.scrollIntoView?.({ block: 'nearest' })
  }, [dialogOpen, search.saved_string, stringsResult.isPlaceholderData])

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
  const modulesResult = useQuery(modulesQuery(projectId))
  const modules = modulesResult.data ?? []
  const { data: tags = [] } = useQuery(tagsQuery(projectId))
  const { data: project } = useQuery(projectQuery(projectId))
  const locales = useMemo(
    () => project?.target_languages.filter((locale) => locale !== project.base_language) ?? [],
    [project?.target_languages, project?.base_language],
  )

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
      setApplySourceConflicts([])
      regenerationIds.current = null
      setRecoveryMessage(null)
      setProposalItems(res.items)
      setReviewTotal(res.total)
      setReviewPage(res.page)
      setReviewPageSize(res.page_size)
      setProposalsReady(false)
      refreshingAfterSave.current = false
      setRefreshError(null)
    },
    onError: (error) => {
      if (refreshingAfterSave.current) {
        // The write already committed; offer a read retry, never a second write.
        setRefreshError(error instanceof Error ? error.message : 'Failed to load missing translations')
        return
      }
      toast.error('Failed to load missing translations')
    },
  })

  function acceptProposals(items: TranslateProposalItem[]) {
    const recovering = regenerationIds.current
    if (recovering) {
      const replacements = items.filter((item) => recovering.includes(item.string_id))
      const replaced = new Set(replacements.map((item) => item.string_id))
      setProposalItems((prev) => mergeProposalResults(prev, replacements.map((item) => ({
        ...item,
        description: prev.find((row) => row.string_id === item.string_id)?.description,
      }))))
      setApplySourceConflicts((prev) => prev.filter((item) => !replaced.has(item.string_id)))
      setRecoveryMessage(recovering.some((id) => !replaced.has(id))
        ? 'No replacement was produced for some changed strings. Retry or remove them from this review.'
        : null)
    } else {
      setProposalItems((prev) => mergeProposalResults(prev, items))
    }
    regenerationIds.current = null
    setProposalsReady(true)
  }

  const proposeMut = useMutation({
    mutationFn: (req: TranslateRequest) => stringsApi.translateProposals(projectId, req),
    onSuccess: (res) => {
      if (res.job_id) {
        setProposalJobId(res.job_id)
        return
      }
      acceptProposals(res.items)
    },
    onError: (error) => toast.error(error.message),
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
      acceptProposals(proposalsFromJobResult(job.result))
      setProposalJobId(null)
    }
  })

  useEffect(() => {
    const job = proposalJobQuery.data
    if (!proposalJobId || !job) return
    if (job.status === 'completed') acceptJobResult(job)
  }, [proposalJobId, proposalJobQuery.data])

  /** Show stale-content conflicts in the editable review. Returns false for other errors. */
  function showWriteConflicts(error: unknown): boolean {
    const changedSources = sourceConflicts(error)
    const filledElsewhere = valueConflicts(error)
    if (!changedSources.length && !filledElsewhere.length) return false
    setApplySourceConflicts(changedSources)
    setRecoveryMessage(filledElsewhere.length ? valueConflictMessage(filledElsewhere) : null)
    setPublishReview(null)
    toast.error(changedSources.length
      ? 'Source text changed. Nothing was saved. Regenerate the changed strings.'
      : 'Some translations were filled elsewhere. Nothing was saved.')
    return true
  }

  // Only the latest review request may open the publication review. Back to edit or a
  // newer review abandons earlier requests; reset() alone still runs these callbacks.
  const reviewRequestId = useRef(0)
  function requestPublicationReview(payload: ReviewPayload) {
    reviewRequestId.current += 1
    setPublishReview({ payload, review: null })
    reviewMut.mutate({ payload, requestId: reviewRequestId.current })
  }
  const reviewMut = useMutation({
    mutationFn: ({ payload }: { payload: ReviewPayload; requestId: number }) =>
      stringsApi.translateReview(projectId, { items: payload }),
    onSuccess: (review, { payload, requestId }) => {
      if (requestId !== reviewRequestId.current) return
      setPublishReview({ payload, review })
    },
    onError: (error, { requestId }) => {
      if (requestId !== reviewRequestId.current) return
      if (showWriteConflicts(error)) return
      setPublishReview(null)
      toast.error(error instanceof Error ? error.message : 'Failed to prepare the publication review')
    },
  })

  const saveMut = useMutation({
    onMutate: ({ items }: SaveVariables) => {
      // Keep the reviewer's edits as the dialog's items so a failed save loses nothing.
      if (items) setProposalItems(items)
    },
    mutationFn: ({ action, payload, fingerprint }: SaveVariables) =>
      stringsApi.translateSave(projectId, { action, items: payload, fingerprint }),
    onSuccess: (res) => {
      const message = saveSuccessMessage(res)
      toast.success(message)
      invalidateStrings()
      if (res.action === 'publish') {
        showPublishedStrings(res.batch_id)
        return
      }
      setSavedNotice(message)
      setPublishReview(null)
      setApplySourceConflicts([])
      setRecoveryMessage(null)
      setProposalJobId(null)
      setProposalsReady(false)
      setProposalItems([])
      proposeMut.reset()
      refreshingAfterSave.current = true
      setRefreshError(null)
      missingMut.mutate(missingRequest(reviewPage))
    },
    onError: (error, { action, payload }) => {
      if (action === 'publish' && isPublishFingerprintMismatch(error)) {
        toast.info('Content changed since review. Nothing was published. Review the updated changes.')
        requestPublicationReview(payload)
        return
      }
      if (showWriteConflicts(error)) return
      toast.error(publicationErrorMessage(error, 'Failed to save translations'))
    },
  })

  function resetReview() {
    reviewRequestId.current += 1
    setReviewOpen(false)
    reviewRequestRef.current = null
    setProposalJobId(null)
    setProposalsReady(false)
    setPublishReview(null)
    setSavedNotice(null)
    setRefreshError(null)
    refreshingAfterSave.current = false
    proposeMut.reset()
  }

  /** Close the review and show exactly the strings this publish changed. */
  function showPublishedStrings(batchId: string) {
    setApplySourceConflicts([])
    setRecoveryMessage(null)
    setProposalItems([])
    resetReview()
    startTransition(() => {
      navigate({ search: (prev) => ({ page: 1, page_size: prev.page_size, batch_id: batchId }) })
    })
  }

  function closeReview() {
    if (saveMut.isPending || reviewMut.isPending || proposeMut.isPending) return
    resetReview()
  }

  function loadMissingPage(page: number) {
    if (!reviewRequestRef.current || saveMut.isPending || proposeMut.isPending || Boolean(proposalJobId)) return
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
    pendingSavedFocus.current = null
    setDialogEntry(entry)
    setDialogTab(tab)
    setDialogOpen(true)
  }, [])

  function closeEditor() {
    setDialogOpen(false)
    setDialogEntry(null)
    setDialogTab('details')
  }

  function showSavedString(entry: StringEntry) {
    const nextSearch = {
      q: entry.key,
      saved_string: entry.id,
      page: 1,
      page_size: search.page_size,
      sort: search.sort,
      order: search.order,
    }
    qc.setQueryData(stringsQueryOptions(projectId, nextSearch).queryKey, {
      items: [entry], total: 1, page: 1, page_size: 1,
    })
    pendingSavedFocus.current = entry.id
    closeEditor()
    setSearchInput(entry.key)
    void navigate({ search: nextSearch })
  }

  function setFilter(updates: Partial<StringsSearch>) {
    startTransition(() => {
      navigate({ search: (prev) => ({ ...prev, ...updates, saved_string: undefined, page: 1 }) })
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

  const tourReady =
    modulesResult.isFetched &&
    !stringsResult.isLoading &&
    !catalogSortListError &&
    !catalogRefetchingEmpty

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (document.querySelector('[data-slot="alert-dialog-content"], [data-slot="dialog-content"]')) return
      event.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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

  function clearAllFilters() {
    setSearchInput('')
    navigate({
      search: {
        page: 1,
        page_size: search.page_size,
        sort: rawSearch.sort,
        order: rawSearch.order,
      },
    })
  }

  const catalogTelemetry = `${total} string${total === 1 ? '' : 's'} · ${locales.length} target language${locales.length === 1 ? '' : 's'}`

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-tour-ready={tourReady ? 'strings' : undefined}
    >
      <div className="relative shrink-0 overflow-hidden bg-card/75 horizon-b">
        <div
          aria-hidden="true"
          className="galley-grid pointer-events-none absolute inset-0 opacity-35"
        />
        <div className="relative flex flex-col gap-3 px-4 py-3 sm:px-6">
          <PageHeader
            title="Strings"
            badge={
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/85 px-2.5 py-0.5 font-mono text-2xs font-normal tabular-nums text-muted-foreground shadow-2xs">
                {catalogTelemetry}
              </span>
            }
            actions={
              <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end w-full sm:w-auto">
                <div
                  role="group"
                  aria-label="Row density"
                  className="hidden sm:inline-flex h-8 items-center rounded-lg border border-border/80 bg-background/85 p-0.5 shadow-2xs"
                >
                  <Tooltip delayDuration={250}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Comfortable density"
                        aria-pressed={density === 'comfortable'}
                        onClick={() => updateDensity('comfortable')}
                        className={cn(
                          'inline-flex h-6.5 items-center justify-center rounded-md px-2 transition-colors',
                          density === 'comfortable'
                            ? 'bg-primary/12 text-primary'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Rows3 className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Comfortable rows</TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={250}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label="Compact density"
                        aria-pressed={density === 'compact'}
                        onClick={() => updateDensity('compact')}
                        className={cn(
                          'inline-flex h-6.5 items-center justify-center rounded-md px-2 transition-colors',
                          density === 'compact'
                            ? 'bg-primary/12 text-primary'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Rows4 className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Compact rows</TooltipContent>
                  </Tooltip>
                </div>

                <DataTableViewOptions
                  table={table}
                  className="bg-background/85 shadow-2xs"
                />

                <Separator orientation="vertical" className="hidden h-5 sm:block text-border/60" />

                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-medium gap-1.5 px-2.5 rounded-lg border-border/80 bg-background/85 text-foreground hover:bg-muted/60 transition-colors shadow-2xs"
                  onClick={() => {
                    reviewRequestRef.current = search.saved_string
                      ? { ...createMissingReviewRequest({}, locales), scope: 'strings', string_ids: [search.saved_string] }
                      : createMissingReviewRequest(search, locales)
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
                    <Spinner data-icon="inline-start" className="size-3.5" />
                  ) : (
                    <Wand2 data-icon="inline-start" className="size-3.5 text-muted-foreground" />
                  )}
                  Translate missing
                </Button>

                <Separator orientation="vertical" className="hidden h-5 sm:block text-border/60" />

                <AddStringMenu
                  className="h-8 text-xs font-medium gap-1.5 px-3 rounded-lg shadow-xs hover:shadow-sm transition-all"
                  onAddSingle={() => openEditor(null)}
                  onAddMany={() => setAddManyOpen(true)}
                />
              </div>
            }
          />
          <div
            role="tablist"
            aria-label="Quick views"
            className="inline-flex w-fit max-w-full flex-wrap items-center gap-1 rounded-xl border border-border/80 bg-muted/55 p-1 shadow-2xs"
          >
            {[
              {
                id: 'all',
                label: 'All strings',
                active: !search.deleted && !search.missing_any && !search.has_unpublished_changes && !search.status && !search.pending_delete && !search.never_published,
                onSelect: () =>
                  setFilter({
                    status: undefined,
                    has_unpublished_changes: undefined,
                    pending_delete: undefined,
                    never_published: undefined,
                    deleted: undefined,
                    missing_any: undefined,
                    missing_locale: undefined,
                    complete_locale: undefined,
                  }),
              },
              {
                id: 'missing',
                label: 'Missing translations',
                active: Boolean(search.missing_any) && !search.deleted,
                onSelect: () =>
                  setFilter({
                    missing_any: true,
                    missing_locale: undefined,
                    complete_locale: undefined,
                    deleted: undefined,
                  }),
              },
              {
                id: 'pending',
                label: 'Needs publish',
                count: pendingCount,
                active: Boolean(search.has_unpublished_changes) && !search.deleted,
                onSelect: () =>
                  setFilter({
                    has_unpublished_changes: true,
                    status: undefined,
                    pending_delete: undefined,
                    never_published: undefined,
                    deleted: undefined,
                  }),
              },
              {
                id: 'deleted',
                label: 'Deleted',
                active: Boolean(search.deleted),
                onSelect: () =>
                  setFilter({
                    deleted: true,
                    status: undefined,
                    has_unpublished_changes: undefined,
                    pending_delete: undefined,
                    never_published: undefined,
                  }),
              },
            ].map((lens) => (
              <button
                key={lens.id}
                type="button"
                role="tab"
                aria-selected={lens.active}
                onClick={lens.onSelect}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-all duration-200 ease-drift',
                  lens.active
                    ? 'bg-card text-foreground shadow-xs ring-1 ring-border/80'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                )}
              >
                <span>{lens.label}</span>
                {typeof lens.count === 'number' && lens.count > 0 ? (
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0 font-mono text-3xs font-semibold tabular-nums',
                      lens.active
                        ? 'bg-primary/12 text-primary'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {lens.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <StringsFilters
            search={search}
            searchInput={searchInput}
            searchInputRef={searchInputRef}
            modules={modules}
            tags={tags}
            locales={locales}
            onSearchInputChange={setSearchInput}
            onFilter={setFilter}
            onReviewPublish={
              search.has_unpublished_changes ? openReviewPublishPreview : undefined
            }
            onClear={clearAllFilters}
          />
        </div>
      </div>

      <div
        className="relative min-h-0 flex-1 bg-card"
        data-tour={data.length > 0 ? 'grid' : undefined}
      >
        {stringsResult.isLoading || catalogSortListError || catalogRefetchingEmpty ? (
          <StringsTableSkeleton localeCount={locales.length} />
        ) : stringsResult.isError ? (
          <div className="flex h-full min-h-48 items-center justify-center galley-grid p-6">
            <EmptyState
              title="Could not load strings"
              description="Failed to load strings. Check your connection and try refreshing the page."
              action={
                <Button variant="outline" size="sm" onClick={() => { void stringsResult.refetch() }}>
                  Retry
                </Button>
              }
            />
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-full min-h-72 items-center justify-center galley-grid p-6">
            <EmptyState
              icon={hasActiveFilters ? <SearchX /> : <AlignLeft />}
              title={emptyCopy.title}
              description={emptyCopy.description}
              action={
                !hasActiveFilters ? (
                  <AddStringMenu
                    size="default"
                    align="center"
                    onAddSingle={() => openEditor(null)}
                    onAddMany={() => setAddManyOpen(true)}
                  />
                ) : (
                  <Button variant="outline" size="sm" onClick={clearAllFilters}>
                    Clear filters
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <DataTable
            table={table}
            regionLabel="Strings catalog"
            density={density}
            bottomSpacer={selectedCount > 0}
            focusRowId={stringsResult.isPlaceholderData ? undefined : search.saved_string}
            focusRowRef={savedRow}
            getRowClassName={(row) => releaseRowClassName(releaseState(row.original))}
            onRowClick={(row, event) => {
              const target = event.target as HTMLElement
              if (target.closest('button, input, [role="checkbox"], [role="switch"], [role="radio"], [role="menuitem"], a')) return
              openEditor(row.original)
            }}
          />
        )}

        {selectedCount > 0 && data.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-3 sm:px-6">
            <div className="pointer-events-auto max-w-full">
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
            </div>
          </div>
        ) : null}
      </div>

      {total > 0 ? (
        <div className="shrink-0 border-t border-border/80 bg-card/95 px-4 backdrop-blur-xs sm:px-6">
          <DataTablePagination table={table} />
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
            onClose={closeEditor}
            initialTab={dialogTab}
            onSuccess={invalidateStrings}
            onSaved={showSavedString}
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
        onSuccess={invalidateStrings}
      />

      <TranslateReviewDialog
        open={reviewOpen}
        projectId={projectId}
        loadingQueue={missingMut.isPending}
        generating={reviewGenerating}
        saving={saveMut.isPending ? saveMut.variables?.action ?? null : null}
        generated={proposalsReady}
        error={reviewError}
        items={reviewItems}
        sourceConflicts={applySourceConflicts}
        recoveryMessage={recoveryMessage}
        onRegenerate={(items) => {
          setProposalItems(items)
          setRecoveryMessage(null)
          setProposalJobId(null)
          const ids = applySourceConflicts.map((item) => item.string_id)
          regenerationIds.current = ids
          proposeMut.mutate({
            scope: 'strings',
            string_ids: ids,
            locales,
          })
        }}
        onRemoveFromReview={(items, stringId) => {
          setProposalItems(items.filter((item) => item.string_id !== stringId))
          setApplySourceConflicts((prev) => prev.filter((item) => item.string_id !== stringId))
          setRecoveryMessage(null)
          setProposalJobId(null)
          regenerationIds.current = null
          proposeMut.reset()
        }}
        page={reviewPage}
        pageSize={reviewPageSize}
        total={reviewTotal}
        progress={proposalJobQuery.data?.progress}
        onPageChange={loadMissingPage}
        onClose={closeReview}
        onTranslate={(items) => {
          setProposalItems(items)
          setProposalJobId(null)
          regenerationIds.current = null
          setRecoveryMessage(null)
          proposeMut.mutate({
            scope: 'strings',
            string_ids: items.map((item) => item.string_id),
            locales,
            exclude_cells: excludedMemoryCells(items),
          })
        }}
        onSaveDraft={(items) => {
          setSavedNotice(null)
          saveMut.mutate({ action: 'draft', items, payload: reviewedPayloadFromDrafts(items) })
        }}
        onReviewPublish={(items) => {
          // Freeze membership, values, and baseline; later edits need a new review.
          const payload = reviewedPayloadFromDrafts(items)
          setProposalItems(items)
          setSavedNotice(null)
          requestPublicationReview(payload)
        }}
        reviewing={publishReview !== null}
        reviewLoading={reviewMut.isPending}
        publishReview={publishReview?.review?.items ?? null}
        onBackToEdit={() => {
          if (saveMut.isPending) return
          reviewRequestId.current += 1
          reviewMut.reset()
          setPublishReview(null)
        }}
        onPublish={() => {
          const frozen = publishReview
          if (!frozen?.review) return
          saveMut.mutate({ action: 'publish', payload: frozen.payload, fingerprint: frozen.review.fingerprint })
        }}
        savedNotice={savedNotice}
        refreshError={refreshError}
        onRetryRefresh={() => missingMut.mutate(missingRequest(reviewPage))}
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
