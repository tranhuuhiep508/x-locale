import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { ColumnDef, Table } from '@tanstack/react-table'
import { CheckCircle, EllipsisVertical, History, Pencil, RotateCcw, Trash2, Undo2 } from 'lucide-react'
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
}

function metaOf(table: Table<StringEntry>) {
  return table.options.meta as StringTableMeta
}

function PublishSwitch({
  entry,
  projectId,
  onRefresh,
}: {
  entry: StringEntry
  projectId: string
  onRefresh: () => void
}) {
  const toast = useToast()
  const locked = entry.pending_delete || Boolean(entry.deleted_at)
  const isPublic = entry.status === 'public' && !entry.deleted_at

  const publishMut = useMutation({
    mutationFn: (action: 'publish' | 'unpublish') =>
      stringsApi.batch(projectId, {
        action,
        string_ids: [entry.id],
      } satisfies BatchRequest),
    onSuccess: (_data, action) => {
      onRefresh()
      toast.success(action === 'publish' ? 'Published' : 'Moved to draft')
    },
    onError: () => toast.error('Failed to update status'),
  })

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <Switch
        size="sm"
        checked={isPublic}
        disabled={publishMut.isPending || locked}
        onCheckedChange={(checked) => {
          if (locked) return
          publishMut.mutate(checked ? 'publish' : 'unpublish')
        }}
        aria-label={isPublic ? 'Public' : 'Draft'}
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
}: {
  entry: StringEntry
  projectId: string
  onEdit: (entry: StringEntry) => void
  onHistory: (entry: StringEntry) => void
  onRefresh: () => void
}) {
  const toast = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmPublishDelete, setConfirmPublishDelete] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const released = isReleased(entry)
  const dirty = entry.has_unpublished_changes && !entry.pending_delete && !entry.deleted_at
  const discardable = canDiscardWorkingCopy(entry)
  const deleted = Boolean(entry.deleted_at)

  const lifecycleMut = useMutation({
    mutationFn: (action: 'publish' | 'restore' | 'discard_changes') =>
      stringsApi.batch(projectId, {
        action,
        string_ids: [entry.id],
      } satisfies BatchRequest),
    onSuccess: (_data, action) => {
      setConfirmPublishDelete(false)
      setConfirmDiscard(false)
      onRefresh()
      if (action === 'restore') {
        toast.success('Restored')
      } else if (action === 'discard_changes') {
        toast.success('Working copy discarded')
      } else if (entry.pending_delete) {
        toast.success('Published deletion')
      } else {
        toast.success('Published')
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
          {dirty || discardable || entry.pending_delete || deleted ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {dirty ? (
                  <DropdownMenuItem
                    disabled={lifecycleMut.isPending}
                    onSelect={() => lifecycleMut.mutate('publish')}
                  >
                    <CheckCircle />
                    Publish working copy
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
                    disabled={lifecycleMut.isPending}
                    onSelect={() => setConfirmPublishDelete(true)}
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
      <ConfirmDialog
        open={confirmPublishDelete}
        onClose={() => setConfirmPublishDelete(false)}
        onConfirm={() => lifecycleMut.mutate('publish')}
        title="Publish this deletion?"
        description="Production will drop this key on the next public pull."
        confirmLabel="Publish delete"
        isLoading={lifecycleMut.isPending}
      />
    </div>
  )
}

export function getStringColumns(targetLocales: string[]): ColumnDef<StringEntry>[] {
  const localeColumns: ColumnDef<StringEntry>[] = targetLocales.map((locale) => ({
    id: `locale-${locale}`,
    header: locale,
    enableSorting: false,
    meta: {
      label: locale.toUpperCase(),
      headerClassName: 'min-w-[160px] uppercase text-xs tracking-wide',
      className: 'align-middle min-w-[160px] whitespace-normal',
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
  }))

  return [
    {
      id: 'select',
      enableSorting: false,
      enableHiding: false,
      meta: { className: 'align-middle' },
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
      header: 'Key',
      enableSorting: false,
      meta: {
        headerClassName: 'min-w-[180px]',
        className: 'align-middle whitespace-normal max-w-[240px]',
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
          <div className="flex flex-col gap-1">
            <div className="flex items-start gap-1.5">
              <span
                className={cn(
                  'min-w-0 font-mono text-xs text-foreground break-all leading-relaxed',
                  state === 'removing' && 'line-through',
                )}
              >
                {entry.key}
              </span>
              {keyChanged ? (
                <ChangedValueHint published={entry.published_key} working={entry.key} mono />
              ) : null}
              <ReleaseBadge state={state} />
            </div>
            {entry.module_slug || moduleChanged ? (
              <div className="flex items-center gap-1">
                <p className="text-[11px] text-muted-foreground font-mono">
                  {entry.module_slug ?? '—'}
                </p>
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
      header: 'Source',
      enableSorting: false,
      meta: {
        headerClassName: 'min-w-[200px]',
        className: 'align-middle max-w-[260px] whitespace-normal',
      },
      cell: ({ row }) => {
        const entry = row.original
        return (
          <div className="flex flex-col gap-1">
            <WorkingCopyCell
              working={entry.source_text}
              published={entry.published_source_text}
              released={isReleased(entry)}
              emptyLabel="Missing"
            />
            {entry.description ? (
              <p className="text-xs text-muted-foreground line-clamp-1">{entry.description}</p>
            ) : null}
          </div>
        )
      },
    },
    ...localeColumns,
    {
      accessorKey: 'status',
      header: 'Published',
      enableSorting: false,
      meta: { headerClassName: 'w-20', className: 'align-middle' },
      cell: ({ row, table }) => {
        const meta = metaOf(table)
        return (
          <PublishSwitch
            entry={row.original}
            projectId={meta.projectId}
            onRefresh={meta.onRefresh}
          />
        )
      },
    },
    {
      id: 'updated_at',
      accessorKey: 'updated_at',
      header: 'Last updated',
      enableSorting: false,
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
      header: 'Updated by',
      enableSorting: false,
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
      header: 'Created',
      enableSorting: false,
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
      header: 'Created by',
      enableSorting: false,
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
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: tag.color + '22', color: tag.color }}
              >
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
      meta: { headerClassName: 'w-10 text-right', className: 'align-middle text-right' },
      cell: ({ row, table }) => {
        const meta = metaOf(table)
        return (
          <StringActionsCell
            entry={row.original}
            projectId={meta.projectId}
            onEdit={meta.onEdit}
            onHistory={meta.onHistory}
            onRefresh={meta.onRefresh}
          />
        )
      },
    },
  ]
}
