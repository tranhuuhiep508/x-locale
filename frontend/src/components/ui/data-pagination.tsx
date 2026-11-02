import type { ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface DataPaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  disabled?: boolean
  /** Keeps Next/Prev focusable when a page change would drop unapplied work. */
  blockedReason?: string
  note?: string
}

function PageButton({
  label,
  disabled,
  blockedReason,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  blockedReason?: string
  onClick: () => void
  children: ReactNode
}) {
  // aria-disabled stays in the tab order so the tooltip is keyboard-reachable.
  if (blockedReason && !disabled) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={label}
            aria-disabled="true"
            className="aria-disabled:opacity-50"
            onClick={(event) => {
              event.preventDefault()
            }}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{blockedReason}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** App-level page controls for list endpoints (page/pageSize/total). */
export function DataPagination({
  page,
  pageSize,
  total,
  onPageChange,
  disabled = false,
  blockedReason,
  note,
}: DataPaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="flex items-center justify-between gap-3 px-1 py-3">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">
          {start}–{end} of {total}
        </p>
        {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        <PageButton
          label="Previous page"
          disabled={disabled || page <= 1}
          blockedReason={blockedReason}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon />
        </PageButton>
        <span className="px-2 text-sm text-muted-foreground">
          {page} / {totalPages}
        </span>
        <PageButton
          label="Next page"
          disabled={disabled || page >= totalPages}
          blockedReason={blockedReason}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRightIcon />
        </PageButton>
      </div>
    </div>
  )
}
