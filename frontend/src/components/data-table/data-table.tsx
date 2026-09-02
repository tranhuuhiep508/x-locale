import { flexRender, type Row, type Table as TanStackTable } from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

import './table-meta.ts'

interface DataTableProps<TData> {
  table: TanStackTable<TData>
  onRowClick?: (row: Row<TData>, event: React.MouseEvent) => void
  getRowClassName?: (row: Row<TData>) => string | undefined
  className?: string
}

export function DataTable<TData>({
  table,
  onRowClick,
  getRowClassName,
  className,
}: DataTableProps<TData>) {
  const rows = table.getRowModel().rows
  const colSpan = table.getVisibleLeafColumns().length

  return (
    <Table className={className} containerClassName="h-full min-h-0 overflow-auto">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                colSpan={header.colSpan}
                className={header.column.columnDef.meta?.headerClassName}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.length > 0 ? (
          rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() ? 'selected' : undefined}
              className={cn(
                onRowClick && 'cursor-pointer group',
                getRowClassName?.(row),
                row.getIsSelected() && 'bg-accent hover:bg-accent',
              )}
              onClick={
                onRowClick
                  ? (event) => {
                      onRowClick(row, event)
                    }
                  : undefined
              }
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
              No results.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
