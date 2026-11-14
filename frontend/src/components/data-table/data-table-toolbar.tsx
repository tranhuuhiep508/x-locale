import { Search, X } from 'lucide-react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'

interface DataTableToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  placeholder?: string
  children?: React.ReactNode
}

export function DataTableToolbar({
  search,
  onSearchChange,
  placeholder = 'Search…',
  children,
}: DataTableToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <InputGroup className="w-full sm:w-64">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          placeholder={placeholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label={placeholder}
        />
        {search ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear search"
              onClick={() => onSearchChange('')}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  )
}
