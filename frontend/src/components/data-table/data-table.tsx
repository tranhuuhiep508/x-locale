import {
  flexRender,
  type Column,
  type Row,
  type Table as TanStackTable,
} from '@tanstack/react-table'
import type { CSSProperties } from 'react'
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

function columnPinningStyle<TData>(column: Column<TData>): CSSProperties | undefined {
  const pinned = column.getIsPinned()
  if (!pinned) return undefined
  return {
    left: pinned === 'left' ? `${column.getStart('left')}px` : undefined,
    right: pinned === 'right' ? `${column.getAfter('right')}px` : undefined,
  }
}

function columnPinningClassName<TData>(column: Column<TData>, variant: 'header' | 'cell') {
  const pinned = column.getIsPinned()
  if (!pinned) return undefined
  return cn(
    'sticky max-sm:static max-sm:shadow-none',
    variant === 'header' ? 'z-20 bg-background' : 'z-[1] bg-inherit',
    pinned === 'left' && column.getIsLastColumn('left') && 'shadow-[inset_-1px_0_0_0_var(--border)]',
    pinned === 'right' && column.getIsFirstColumn('right') && 'shadow-[inset_1px_0_0_0_var(--border)]',
  )
}

export function DataTable<TData>({
  table,
  onRowClick,
  getRowClassName,
  className,
}: DataTableProps<TData>) {
  const rows = table.getRowModel().rows
  const colSpan = table.getVisibleLeafColumns().length
  const pinning = table.getState().columnPinning
  const hasPinnedColumns =
    (pinning.left?.length ?? 0) > 0 || (pinning.right?.length ?? 0) > 0

  return (
    <Table className={className} containerClassName="h-full min-h-0 overflow-auto">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                colSpan={header.colSpan}
                className={cn(
                  header.column.columnDef.meta?.headerClassName,
                  columnPinningClassName(header.column, 'header'),
                )}
                style={columnPinningStyle(header.column)}
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
                hasPinnedColumns && 'bg-background',
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
                <TableCell
                  key={cell.id}
                  className={cn(
                    cell.column.columnDef.meta?.className,
                    columnPinningClassName(cell.column, 'cell'),
                  )}
                  style={columnPinningStyle(cell.column)}
                >
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
