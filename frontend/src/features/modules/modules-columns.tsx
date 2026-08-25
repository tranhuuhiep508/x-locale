import type { ColumnDef, Table } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Module } from '@/lib/api/types'

export type ModuleTableMeta = {
  onEdit: (module: Module) => void
  onDelete: (module: Module) => void
}

function metaOf(table: Table<Module>) {
  return table.options.meta as ModuleTableMeta
}

export const moduleColumns: ColumnDef<Module>[] = [
  {
    accessorKey: 'slug',
    header: 'Slug',
    enableSorting: false,
    cell: ({ getValue }) => (
      <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
        {getValue<string>()}
      </code>
    ),
  },
  {
    accessorKey: 'name',
    header: 'Name',
    enableSorting: false,
    meta: { className: 'font-medium' },
  },
  {
    id: 'description',
    header: 'Description',
    enableSorting: false,
    accessorFn: (row) => row.description ?? '',
    meta: { className: 'text-muted-foreground text-sm max-w-xs truncate' },
    cell: ({ row }) => row.original.description ?? '—',
  },
  {
    accessorKey: 'string_count',
    header: 'Strings',
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ getValue }) => <Badge variant="default">{getValue<number>()}</Badge>,
  },
  {
    id: 'actions',
    enableSorting: false,
    enableHiding: false,
    enableGlobalFilter: false,
    cell: ({ row, table }) => {
      const meta = metaOf(table)
      const module = row.original
      return (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => meta.onEdit(module)}
            aria-label={`Edit ${module.name}`}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => meta.onDelete(module)}
            aria-label={`Delete ${module.name}`}
          >
            <Trash2 />
          </Button>
        </div>
      )
    },
  },
]
