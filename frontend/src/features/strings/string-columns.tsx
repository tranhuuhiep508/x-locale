import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { ColumnDef, Table } from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle,
  Copy,
  EllipsisVertical,
  History,
  Pencil,
  RotateCcw,
  Trash2,
  Undo2,
} from 'lucide-react'
import {
  type CatalogSortField,
  type CatalogSortSearch,
  resolvedCatalogSort,
} from '@/features/strings/catalog-sort'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { batchSuccessMessage, unpublishConfirmCopy } from '@/features/strings/batch-feedback'
import { ConfidenceBadge } from '@/features/strings/confidence'
import {
  ChangedValueHint,
  WorkingCopyCell,
  canDiscardWorkingCopy,
  fieldChanged,
  isReleased,
  liveTranslation,
  releaseState,
  ReleaseBadge,
} from '@/features/strings/working-copy'
import { stringsApi } from '@/lib/api/strings'
import type { BatchRequest, StringEntry } from '@/lib/api/types'
import { useToast } from '@/lib/toast'
import { cn, formatDate, formatRelativeTime } from '@/lib/utils'

export type StringTableMeta = {
  projectId: string
  onEdit: (entry: StringEntry) => void
  onHistory: (entry: StringEntry) => void
  onRefresh: () => void
  onPublishPreview: (entry: StringEntry) => void
  catalogSort: CatalogSortSearch
  onCatalogSortToggle: (columnId: CatalogSortField) => void
}

function CatalogSortableHeader({
  columnId,
  label,
  table,
}: {
  columnId: CatalogSortField
  label: string
  table: Table<StringEntry>
}) {
  const meta = metaOf(table)
  const resolved = resolvedCatalogSort(meta.catalogSort)
  const isActive = resolved.sort === columnId
  const ariaSort = isActive ? (resolved.order === 'asc' ? 'ascending' : 'descending') : 'none'

  return (
    <button
      type="button"
      className={cn(
        'eyebrow -ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-left',
        'hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isActive && 'text-foreground',
      )}
      aria-sort={ariaSort}
      data-tour={columnId === 'key' ? 'sort' : undefined}
      onClick={() => meta.onCatalogSortToggle(columnId)}
    >
      <span>{label}</span>
      {isActive ? (
        resolved.order === 'asc' ? (
          <ArrowUp className="size-3.5 shrink-0 opacity-70" aria-hidden />
        ) : (
          <ArrowDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
        )
      ) : null}
    </button>
  )
}

function metaOf(table: Table<StringEntry>) {
  return table.options.meta as StringTableMeta
}

const languageDisplayNames =
  typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null

function formatLocaleName(locale: string): string | null {
  if (!languageDisplayNames) return null
  try {
    const resolved = languageDisplayNames.of(locale)
    if (!resolved || resolved.toLowerCase() === locale.toLowerCase()) return null
    return resolved
  } catch {
    return null
  }
}

function CopyKeyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <button
      type="button"
      aria-label={`Copy key ${value}`}
      title="Copy key"
      onClick={(event) => {
        event.stopPropagation()
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true)
          if (timerRef.current != null) window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => setCopied(false), 1500)
        }).catch(() => {})
      }}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        copied ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100',
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  )
}

export function PublishSwitch({
  entry,
  projectId,
  onRefresh,
  onPublishPreview,
}: {
  entry: StringEntry
  projectId: string
  onRefresh: () => void
  onPublishPreview: (entry: StringEntry) => void
}) {
  const toast = useToast()
  const [confirmUnpublish, setConfirmUnpublish] = useState(false)
  const locked = entry.pending_delete || Boolean(entry.deleted_at)
  const isPublic = entry.status === 'public' && !entry.deleted_at
  const unpublishCopy = unpublishConfirmCopy(1)
  const statusLabel = entry.deleted_at
    ? 'Deleted'
    : entry.pending_delete
      ? 'Queued'
      : isPublic
        ? 'Live'
        : 'Draft'

  const unpublishMut = useMutation({
    mutationFn: () =>
      stringsApi.batch(projectId, {
        action: 'unpublish',
        string_ids: [entry.id],
      } satisfies BatchRequest),
    onSuccess: (data) => {
      setConfirmUnpublish(false)
      onRefresh()
      toast.success(batchSuccessMessage('unpublish', data.affected) ?? 'Unpublished 1 string')
    },
    onError: () => toast.error('Failed to update status'),
  })

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      className="inline-flex items-center gap-2"
    >
      <Switch
        size="sm"
        checked={isPublic}
        disabled={unpublishMut.isPending || locked}
        onCheckedChange={(checked) => {
          if (locked) return
          if (checked) onPublishPreview(entry)
          else setConfirmUnpublish(true)
        }}
        aria-label={isPublic ? 'Public' : 'Draft'}
      />
      <span
        aria-hidden="true"
        className={cn(
          'font-mono text-3xs font-medium tracking-wide',
          entry.pending_delete
            ? 'text-destructive'
            : isPublic && !entry.deleted_at
              ? 'text-foreground'
              : 'text-muted-foreground',
        )}
      >
        {statusLabel}
      </span>
      <ConfirmDialog
        open={confirmUnpublish}
        onClose={() => setConfirmUnpublish(false)}
        onConfirm={() => unpublishMut.mutate()}
        title={unpublishCopy.title}
        description={unpublishCopy.description}
        confirmLabel={unpublishCopy.confirmLabel}
        variant="default"
        isLoading={unpublishMut.isPending}
      />
    </div>
  )
}

function StringActionsCell({
  entry,
  projectId,
  onEdit,
  onHistory,
  onRefresh,
  onPublishPreview,
}: {
  entry: StringEntry
  projectId: string
  onEdit: (entry: StringEntry) => void
  onHistory: (entry: StringEntry) => void
  onRefresh: () => void
  onPublishPreview: (entry: StringEntry) => void
}) {
  const toast = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const released = isReleased(entry)
  const dirty = entry.has_unpublished_changes && !entry.pending_delete && !entry.deleted_at
  const discardable = canDiscardWorkingCopy(entry)
  const deleted = Boolean(entry.deleted_at)

  const lifecycleMut = useMutation({
    mutationFn: (action: 'restore' | 'discard_changes') =>
      stringsApi.batch(projectId, {
        action,
        string_ids: [entry.id],
      } satisfies BatchRequest),
    onSuccess: (_data, action) => {
      setConfirmDiscard(false)
      onRefresh()
      if (action === 'restore') {
        toast.success('Restored as draft')
      } else {
        toast.success('Working copy discarded')
      }
    },
    onError: () => toast.error('Failed to update string'),
  })

  const deleteMut = useMutation({
    mutationFn: () => stringsApi.delete(projectId, entry.id),
    onSuccess: () => {
      setConfirmDelete(false)
      onRefresh()
      toast.success(
        released ? 'Deletion queued — prod keeps the current text until you publish this removal' : 'String deleted',
      )
    },
    onError: () => toast.error('Failed to delete string'),
  })

  const pending = lifecycleMut.isPending || deleteMut.isPending
  const deleteDisabled = entry.pending_delete || deleted
  const deleteLabel = deleted
    ? 'Already deleted'
    : entry.pending_delete
      ? 'Deletion already pending'
      : 'Delete'

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Row actions"
            disabled={pending}
            className="text-muted-foreground"
          >
            {pending ? <Spinner /> : <EllipsisVertical />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={() => onEdit(entry)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onHistory(entry)}>
              <History />
              History
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {dirty || discardable || entry.pending_delete || deleted || !released ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {dirty || (!released && !deleted) ? (
                  <DropdownMenuItem
                    onSelect={() => onPublishPreview(entry)}
                  >
                    <CheckCircle />
                    {dirty ? 'Publish working copy' : 'Publish'}
                  </DropdownMenuItem>
                ) : null}
                {discardable ? (
                  <DropdownMenuItem
                    disabled={lifecycleMut.isPending}
                    onSelect={() => setConfirmDiscard(true)}
                  >
                    <Undo2 />
                    Discard changes
                  </DropdownMenuItem>
                ) : null}
                {entry.pending_delete ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => onPublishPreview(entry)}
                  >
                    <CheckCircle />
                    Publish delete
                  </DropdownMenuItem>
                ) : null}
                {deleted ? (
                  <DropdownMenuItem
                    disabled={lifecycleMut.isPending}
                    onSelect={() => lifecycleMut.mutate('restore')}
                  >
                    <RotateCcw />
                    Restore
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              disabled={deleteDisabled || deleteMut.isPending}
              onSelect={() => setConfirmDelete(true)}
            >
              <Trash2 />
              {deleteLabel}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        onConfirm={() => lifecycleMut.mutate('discard_changes')}
        title="Discard working copy?"
        description={
          entry.pending_delete
            ? 'Cancels the pending removal and restores the last published text in staging.'
            : 'Reverts staging to the last published snapshot. Production is unchanged.'
        }
        confirmLabel="Discard changes"
        isLoading={lifecycleMut.isPending}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMut.mutate()}
        title={released ? 'Remove this published string?' : 'Delete this string?'}
        description={
          released
            ? 'Prod keeps the current text until you publish this removal. Staging draft pull will hide the key.'
            : 'The string is hidden from the grid. Restore it from the Deleted filter, or revert the activity.'
        }
        confirmLabel={released ? 'Queue deletion' : 'Delete'}
        isLoading={deleteMut.isPending}
      />
    </div>
  )
}

export function getStringColumns(targetLocales: string[]): ColumnDef<StringEntry>[] {
  const localeColumns: ColumnDef<StringEntry>[] = targetLocales.map((locale) => {
    const langName = formatLocaleName(locale)
    return {
      id: `locale-${locale}`,
      header: () => (
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded border border-border/80 bg-card/90 px-1.5 py-0.5 font-mono text-3xs font-semibold tracking-wider text-foreground">
            {locale.toUpperCase()}
          </span>
          {langName ? (
            <span className="font-sans text-2xs font-normal normal-case tracking-normal text-muted-foreground">
              {langName}
            </span>
          ) : null}
        </span>
      ),
      enableSorting: false,
      meta: {
        label: locale.toUpperCase(),
        headerClassName: 'min-w-[180px]',
        className: 'align-middle min-w-[180px] whitespace-normal',
      },
      cell: ({ row }) => {
        const entry = row.original
        const translation = entry.translations.find((item) => item.locale === locale)
        return (
          <div className="flex flex-col gap-1">
            <WorkingCopyCell
              working={translation?.value ?? ''}
              published={liveTranslation(entry, locale)}
              released={isReleased(entry)}
            />
            <ConfidenceBadge
              score={translation?.value?.trim() ? translation.confidence : null}
            />
          </div>
        )
      },
    }
  })

  return [
    {
      id: 'select',
      enableSorting: false,
      enableHiding: false,
      size: 40,
      minSize: 40,
      maxSize: 40,
      meta: {
        headerClassName: 'w-10 min-w-10 max-w-10',
        className: 'align-middle w-10 min-w-10 max-w-10',
      },
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && 'indeterminate')
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <div onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      ),
    },
    {
      accessorKey: 'key',
      header: ({ table }) => <CatalogSortableHeader columnId="key" label="Key" table={table} />,
      enableSorting: true,
      size: 220,
      minSize: 180,
      meta: {
        headerClassName: 'min-w-[180px]',
        className: 'align-middle whitespace-normal min-w-[180px] max-w-[240px]',
      },
      cell: ({ row }) => {
        const entry = row.original
        const state = releaseState(entry)
        const released = isReleased(entry)
        const keyChanged = fieldChanged(entry.key, entry.published_key, released)
        const moduleChanged = fieldChanged(
          entry.module_slug ?? '',
          entry.published_module_slug ?? '',
          released,
        )
        return (
          <div className="flex flex-col gap-1.5" data-tour={row.index === 0 ? 'string-open' : undefined}>
            <div className="flex items-start justify-between gap-1.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    'min-w-0 font-mono text-xs font-medium text-foreground break-all leading-snug',
                    state === 'removing' && 'line-through text-muted-foreground',
                  )}
                >
                  {entry.key}
                </span>
                {keyChanged ? (
                  <ChangedValueHint published={entry.published_key} working={entry.key} mono />
                ) : null}
                <ReleaseBadge state={state} />
              </div>
              <CopyKeyButton value={entry.key} />
            </div>
            {entry.module_slug || moduleChanged ? (
              <div className="flex items-center gap-1.5 group-data-[density=compact]/table:hidden">
                <span className="inline-flex items-center rounded border border-border/75 bg-muted/45 px-1.5 py-0.5 font-mono text-3xs leading-none text-muted-foreground">
                  {entry.module_slug ?? '—'}
                </span>
                {moduleChanged ? (
                  <ChangedValueHint
                    published={entry.published_module_slug}
                    working={entry.module_slug ?? ''}
                    mono
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'source_text',
      header: ({ table }) => (
        <CatalogSortableHeader columnId="source_text" label="Source" table={table} />
      ),
      enableSorting: true,
      meta: {
        headerClassName: 'min-w-[220px]',
        className: 'align-middle min-w-[220px] max-w-[300px] whitespace-normal',
      },
      cell: ({ row }) => {
        const entry = row.original
        return (
          <div className="flex flex-col gap-1.5">
            <WorkingCopyCell
              working={entry.source_text}
              published={entry.published_source_text}
              released={isReleased(entry)}
              emptyLabel="Missing"
            />
            {entry.description ? (
              <p className="border-l-2 border-border pl-2 text-xs leading-relaxed text-muted-foreground line-clamp-1 group-data-[density=compact]/table:hidden">
                {entry.description}
              </p>
            ) : null}
          </div>
        )
      },
    },
    ...localeColumns,
    {
      accessorKey: 'status',
      header: ({ table }) => (
        <CatalogSortableHeader columnId="status" label="Published" table={table} />
      ),
      enableSorting: true,
      meta: { headerClassName: 'w-28 min-w-28', className: 'align-middle whitespace-nowrap' },
      cell: ({ row, table }) => {
        const meta = metaOf(table)
        return (
          <div data-tour={row.index === 0 ? 'publish-toggle' : undefined}>
            <PublishSwitch
              entry={row.original}
              projectId={meta.projectId}
              onRefresh={meta.onRefresh}
              onPublishPreview={meta.onPublishPreview}
            />
          </div>
        )
      },
    },
    {
      id: 'updated_at',
      accessorKey: 'updated_at',
      header: ({ table }) => (
        <CatalogSortableHeader columnId="updated_at" label="Last updated" table={table} />
      ),
      enableSorting: true,
      meta: {
        label: 'Last updated',
        headerClassName: 'min-w-[7rem]',
        className: 'align-middle whitespace-nowrap',
      },
      cell: ({ row }) => {
        const updatedAt = row.original.updated_at
        if (!updatedAt) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatRelativeTime(updatedAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{formatDate(updatedAt)}</TooltipContent>
          </Tooltip>
        )
      },
    },
    {
      id: 'updated_by_label',
      accessorKey: 'updated_by_label',
      header: ({ table }) => (
        <CatalogSortableHeader columnId="updated_by_label" label="Updated by" table={table} />
      ),
      enableSorting: true,
      meta: {
        label: 'Updated by',
        headerClassName: 'min-w-[7rem]',
        className: 'align-middle max-w-[10rem] whitespace-normal',
      },
      cell: ({ row }) => {
        const author = row.original.updated_by_label
        const actorType = row.original.updated_by_type
        if (!author) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <span className="text-xs text-foreground truncate block">{author}</span>
            </TooltipTrigger>
            {actorType ? <TooltipContent>{actorType}</TooltipContent> : null}
          </Tooltip>
        )
      },
    },
    {
      id: 'created_at',
      accessorKey: 'created_at',
      header: ({ table }) => (
        <CatalogSortableHeader columnId="created_at" label="Created" table={table} />
      ),
      enableSorting: true,
      meta: {
        label: 'Created',
        headerClassName: 'min-w-[7rem]',
        className: 'align-middle whitespace-nowrap',
      },
      cell: ({ row }) => {
        const createdAt = row.original.created_at
        if (!createdAt) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatRelativeTime(createdAt)}
              </span>
            </TooltipTrigger>
            <TooltipContent>{formatDate(createdAt)}</TooltipContent>
          </Tooltip>
        )
      },
    },
    {
      id: 'created_by_label',
      accessorKey: 'created_by_label',
      header: ({ table }) => (
        <CatalogSortableHeader columnId="created_by_label" label="Created by" table={table} />
      ),
      enableSorting: true,
      meta: {
        label: 'Created by',
        headerClassName: 'min-w-[7rem]',
        className: 'align-middle max-w-[10rem] whitespace-normal',
      },
      cell: ({ row }) => {
        const author = row.original.created_by_label
        const actorType = row.original.created_by_type
        if (!author) {
          return <span className="text-xs text-muted-foreground">—</span>
        }
        return (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <span className="text-xs text-foreground truncate block">{author}</span>
            </TooltipTrigger>
            {actorType ? <TooltipContent>{actorType}</TooltipContent> : null}
          </Tooltip>
        )
      },
    },
    {
      id: 'tags',
      header: 'Tags',
      accessorFn: (row) => row.tags.map((tag) => tag.name).join(' '),
      enableSorting: false,
      meta: {
        headerClassName: 'min-w-[120px]',
        className: 'align-middle whitespace-normal',
      },
      cell: ({ row }) =>
        row.original.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.original.tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/45 px-1.5 py-0.5 text-2xs font-medium text-foreground"
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      enableHiding: false,
      size: 44,
      minSize: 44,
      maxSize: 44,
      meta: {
        headerClassName: 'w-11 min-w-11 max-w-11 text-right',
        className: 'align-middle w-11 min-w-11 max-w-11 text-right',
      },
      cell: ({ row, table }) => {
        const meta = metaOf(table)
        return (
          <StringActionsCell
            entry={row.original}
            projectId={meta.projectId}
            onEdit={meta.onEdit}
            onHistory={meta.onHistory}
            onRefresh={meta.onRefresh}
            onPublishPreview={meta.onPublishPreview}
          />
        )
      },
    },
  ]
}
