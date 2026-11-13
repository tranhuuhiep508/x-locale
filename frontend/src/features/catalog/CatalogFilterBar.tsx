import { useEffect, useState } from 'react'
import { ArrowUpDown, Search, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type CatalogFilterOption<T extends string> = {
  value: T
  label: string
  count: number
}

export type CatalogSortOption<T extends string> = {
  value: T
  label: string
}

/** Transient copy-state tracker for slug or color tokens inside catalog cards. */
export function useCopiedToken() {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    if (!copiedId) return
    const timer = window.setTimeout(() => setCopiedId(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copiedId])

  function copyToken(id: string, value: string) {
    void navigator.clipboard?.writeText(value)
    setCopiedId(id)
  }

  return { copiedId, copyToken }
}

export function CatalogFilterBar<F extends string, S extends string>({
  search,
  onSearchChange,
  searchPlaceholder,
  searchLabel,
  filter,
  onFilterChange,
  filterOptions,
  filterLabel,
  sort,
  onSortChange,
  sortOptions,
  sortLabel,
  matchCount,
  isFiltered,
}: {
  search: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  searchLabel: string
  filter: F
  onFilterChange: (value: F) => void
  filterOptions: CatalogFilterOption<F>[]
  filterLabel: string
  sort: S
  onSortChange: (value: S) => void
  sortOptions: CatalogSortOption<S>[]
  sortLabel: string
  matchCount: number
  isFiltered: boolean
}) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <InputGroup className="min-w-52 flex-1 bg-card sm:max-w-xs">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
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

        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={filter}
          aria-label={filterLabel}
          onValueChange={(value) => {
            if (value) onFilterChange(value as F)
          }}
        >
          {filterOptions.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="gap-1.5 bg-card">
              <span>{option.label}</span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                {option.count}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex items-center justify-between gap-2 sm:justify-end">
        {isFiltered ? (
          <Badge variant="secondary" className="font-mono text-xs tabular-nums">
            {matchCount} {matchCount === 1 ? 'match' : 'matches'}
          </Badge>
        ) : null}
        <Select value={sort} onValueChange={(value) => onSortChange(value as S)}>
          <SelectTrigger aria-label={sortLabel} className="h-8 bg-card text-xs">
            <ArrowUpDown className="size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function CatalogFilteredEmpty({
  title,
  description,
  onClear,
}: {
  title: string
  description: string
  onClear: () => void
}) {
  return (
    <div className="animate-stage-in flex flex-col items-center justify-center rounded-xl border border-dashed border-border/85 bg-card/50 px-6 py-12 text-center">
      <Search className="mb-2.5 size-7 text-muted-foreground/60" />
      <h2 className="font-heading text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  )
}
