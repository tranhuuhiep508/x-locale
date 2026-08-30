import { useMutation } from '@tanstack/react-query'
import type { ColumnDef, Table } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { stringsApi } from '@/lib/api/strings'
import type { BatchRequest, StringEntry, Translation } from '@/lib/api/types'
import { useToast } from '@/lib/toast'

export type StringTableMeta = {
  projectId: string
  onEdit: (entry: StringEntry) => void
  onRefresh: () => void
}

function metaOf(table: Table<StringEntry>) {
  return table.options.meta as StringTableMeta
}

function TranslationPreview({ translation }: { translation?: Translation }) {
  const value = translation?.value?.trim() ?? ''

  if (!value) {
    return <span className="text-missing-foreground italic text-sm">Missing</span>
  }

  return (
    <p className="text-sm leading-snug line-clamp-2 whitespace-normal wrap-break-word">
      {value}
    </p>
  )
}

function PublishCell({
  entry,
  projectId,
  onRefresh,
}: {
  entry: StringEntry
  projectId: string
  onRefresh: () => void
}) {
  const toast = useToast()
  const isPublic = entry.status === 'public'

  const publishMut = useMutation({
    mutationFn: (publish: boolean) =>
      stringsApi.batch(projectId, {
        action: publish ? 'publish' : 'unpublish',
        string_ids: [entry.id],
      } satisfies BatchRequest),
    onSuccess: (_data, publish) => {
      onRefresh()
      toast.success(publish ? 'Published' : 'Moved to draft')
    },
    onError: () => toast.error('Failed to update status'),
  })

  return (
    <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
      <Switch
        size="sm"
        checked={isPublic}
        disabled={publishMut.isPending}
        onCheckedChange={(checked) => publishMut.mutate(checked)}
        aria-label={isPublic ? 'Published' : 'Draft'}
      />
      <span
        className={
          isPublic
            ? 'text-xs font-medium text-public-foreground'
            : 'text-xs text-draft-foreground'
        }
      >
        {publishMut.isPending ? '…' : isPublic ? 'Public' : 'Draft'}
      </span>
    </div>
  )
}

function StringActionsCell({
  entry,
  projectId,
  onEdit,
  onRefresh,
}: {
  entry: StringEntry
  projectId: string
  onEdit: (entry: StringEntry) => void
  onRefresh: () => void
}) {
  const toast = useToast()

  const deleteMut = useMutation({
    mutationFn: () => stringsApi.delete(projectId, entry.id),
    onSuccess: () => {
      onRefresh()
      toast.success('String deleted')
    },
    onError: () => toast.error('Failed to delete string'),
  })

  return (
    <div
      className="flex items-center justify-end gap-0.5 opacity-70 group-hover:opacity-100"
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        title="Edit"
        onClick={() => onEdit(entry)}
        className="text-muted-foreground hover:text-foreground"
      >
        <Pencil />
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
      const translation = row.original.translations.find((item) => item.locale === locale)
      return <TranslationPreview translation={translation} />
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
        headerClassName: 'min-w-[160px]',
        className: 'align-middle whitespace-normal max-w-[220px]',
      },
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs text-foreground break-all leading-relaxed">
            {row.original.key}
          </span>
          {row.original.module_slug ? (
            <p className="text-[11px] text-muted-foreground font-mono">{row.original.module_slug}</p>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'source_text',
      header: 'Source',
      enableSorting: false,
      meta: {
        headerClassName: 'min-w-[200px]',
        className: 'align-middle max-w-[260px] whitespace-normal',
      },
      cell: ({ row }) => (
        <>
          <p className="text-sm text-foreground leading-relaxed line-clamp-2">
            {row.original.source_text}
          </p>
          {row.original.description ? (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
              {row.original.description}
            </p>
          ) : null}
        </>
      ),
    },
    ...localeColumns,
    {
      accessorKey: 'status',
      header: 'Published',
      enableSorting: false,
      meta: { headerClassName: 'w-28', className: 'align-middle' },
      cell: ({ row, table }) => {
        const meta = metaOf(table)
        return (
          <PublishCell
            entry={row.original}
            projectId={meta.projectId}
            onRefresh={meta.onRefresh}
          />
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
      header: 'Actions',
      enableSorting: false,
      enableHiding: false,
      meta: { headerClassName: 'w-24 text-right', className: 'align-middle text-right' },
      cell: ({ row, table }) => {
        const meta = metaOf(table)
        return (
          <StringActionsCell
            entry={row.original}
            projectId={meta.projectId}
            onEdit={meta.onEdit}
            onRefresh={meta.onRefresh}
          />
        )
      },
    },
  ]
}
