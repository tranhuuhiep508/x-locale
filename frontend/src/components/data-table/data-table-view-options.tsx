import type { Table } from '@tanstack/react-table'
import { Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface DataTableViewOptionsProps<TData> {
  table: Table<TData>
  className?: string
}

function columnLabel<TData>(column: ReturnType<Table<TData>['getAllColumns']>[number]) {
  return (
    column.columnDef.meta?.label ??
    (typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id)
  )
}

export function DataTableViewOptions<TData>({ table, className }: DataTableViewOptionsProps<TData>) {
  const hideable = table.getAllColumns().filter((column) => column.getCanHide())
  if (hideable.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 text-xs font-medium gap-1.5 px-2.5 rounded-lg border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors',
            className
          )}
        >
          <Columns3 data-icon="inline-start" className="size-3.5" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideable.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            onCheckedChange={(value) => column.toggleVisibility(!!value)}
            onSelect={(event) => event.preventDefault()}
          >
            {columnLabel(column)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
