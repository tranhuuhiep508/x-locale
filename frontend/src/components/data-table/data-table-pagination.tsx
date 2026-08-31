import type { ReactNode } from 'react'
import type { Table } from '@tanstack/react-table'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const DEFAULT_PAGE_SIZES = [10, 20, 50]

interface DataTablePaginationProps<TData> {
  table: Table<TData>
  pageSizeOptions?: number[]
  center?: ReactNode
}

export function DataTablePagination<TData>({
  table,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  center,
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination
  const total = table.options.manualPagination
    ? (table.options.rowCount ?? 0)
    : table.getFilteredRowModel().rows.length
  if (total === 0) return null

  const pageCount = Math.max(table.getPageCount(), 1)

  const start = total === 0 ? 0 : pageIndex * pageSize + 1
  const end = Math.min((pageIndex + 1) * pageSize, total)
  const page = pageIndex + 1

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-3">
      <p className="text-sm text-muted-foreground">
        {start}–{end} of {total}
      </p>
      <div className="flex min-w-0 items-center justify-center">{center}</div>
      <div className="flex items-center gap-3">
        <Select
          value={String(pageSize)}
          onValueChange={(value) => table.setPageSize(Number(value))}
        >
          <SelectTrigger size="sm" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            aria-label="Previous page"
          >
            <ChevronLeftIcon />
          </Button>
          <span className="px-2 text-sm text-muted-foreground">
            {page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            aria-label="Next page"
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
