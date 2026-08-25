import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

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
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="w-56 pl-8"
          placeholder={placeholder}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label={placeholder}
        />
      </div>
      {children}
    </div>
  )
}
