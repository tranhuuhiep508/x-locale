import type { ColumnDef, Table } from '@tanstack/react-table'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ApiKey } from '@/lib/api/types'
import { formatDate } from '@/lib/utils'

export type ApiKeyTableMeta = {
  onRevoke: (key: ApiKey) => void
}

function metaOf(table: Table<ApiKey>) {
  return table.options.meta as ApiKeyTableMeta
}

export const apiKeyColumns: ColumnDef<ApiKey>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    enableSorting: false,
    meta: { className: 'font-medium' },
  },
  {
    accessorKey: 'key_prefix',
    header: 'Prefix',
    enableSorting: false,
    cell: ({ getValue }) => (
      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{getValue<string>()}…</code>
    ),
  },
  {
    accessorKey: 'created_at',
    header: 'Created',
    enableSorting: false,
    enableGlobalFilter: false,
    meta: { className: 'text-muted-foreground text-xs' },
    cell: ({ getValue }) => formatDate(getValue<string | null>()),
  },
  {
    accessorKey: 'last_used_at',
    header: 'Last used',
    enableSorting: false,
    enableGlobalFilter: false,
    meta: { className: 'text-muted-foreground text-xs' },
    cell: ({ getValue }) => {
      const value = getValue<string | null>()
      return value ? formatDate(value) : '—'
    },
  },
  {
    id: 'status',
    header: 'Status',
    accessorFn: (row) => (row.revoked_at ? 'Revoked' : 'Active'),
    enableSorting: false,
    cell: ({ row }) =>
      row.original.revoked_at ? (
        <Badge variant="destructive">Revoked</Badge>
      ) : (
        <Badge variant="default">Active</Badge>
      ),
  },
  {
    id: 'actions',
    enableSorting: false,
    enableHiding: false,
    enableGlobalFilter: false,
    cell: ({ row, table }) => {
      if (row.original.revoked_at) return null
      const meta = metaOf(table)
      return (
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => meta.onRevoke(row.original)}
          aria-label={`Revoke ${row.original.name}`}
        >
          <Trash2 />
        </Button>
      )
    },
  },
]
