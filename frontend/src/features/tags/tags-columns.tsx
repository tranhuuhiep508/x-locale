import type { ColumnDef, Table } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Tag } from '@/lib/api/types'

export type TagTableMeta = {
  onEdit: (tag: Tag) => void
  onDelete: (tag: Tag) => void
}

function metaOf(table: Table<Tag>) {
  return table.options.meta as TagTableMeta
}

export const tagColumns: ColumnDef<Tag>[] = [
  {
    accessorKey: 'name',
    header: 'Tag',
    enableSorting: false,
    cell: ({ row }) => {
      const tag = row.original
      return (
        <span
          className="flex items-center gap-2 px-2.5 py-0.5 rounded-full text-sm font-medium w-fit"
          style={{ backgroundColor: tag.color + '22', color: tag.color }}
        >
          <span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
          {tag.name}
        </span>
      )
    },
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
      const tag = row.original
      return (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => meta.onEdit(tag)}
            aria-label={`Edit ${tag.name}`}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => meta.onDelete(tag)}
            aria-label={`Delete ${tag.name}`}
          >
            <Trash2 />
          </Button>
        </div>
      )
    },
  },
]
