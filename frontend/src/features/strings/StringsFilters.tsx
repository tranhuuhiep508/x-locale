import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, GitCompareArrows, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CONFIDENCE_LOW_MAX, CONFIDENCE_REVIEW_MAX } from '@/features/strings/confidence'
import type { Module, Tag } from '@/lib/api/types'
import type { StringsSearch } from '@/lib/schemas'
import { cn } from '@/lib/utils'

const STATUS_ALL = 'all'
const CONFIDENCE_ALL = 'all'

function statusValue(search: StringsSearch) {
  if (search.deleted) return 'deleted'
  if (search.has_unpublished_changes) return 'needs_publish'
  return search.status ?? STATUS_ALL
}

function confidenceValue(search: StringsSearch) {
  if (search.max_confidence === CONFIDENCE_LOW_MAX) return 'low'
  if (search.max_confidence === CONFIDENCE_REVIEW_MAX) return 'review'
  return CONFIDENCE_ALL
}

export function hasActiveStringFilters(search: StringsSearch) {
  return Boolean(
    search.q ||
      search.module ||
      search.tag ||
      search.status ||
      search.missing_locale ||
      search.has_unpublished_changes ||
      search.pending_delete ||
      search.deleted ||
      search.max_confidence != null,
  )
}

type FilterOption = {
  value: string
  label: string
  keywords?: string
}

const ALL_OPTION: FilterOption = { value: 'all', label: 'All' }
const VISIBLE_LIMIT = 80

function filterOptions(options: FilterOption[], query: string, selectedValue: string) {
  const q = query.trim().toLowerCase()
  const matched = q
    ? options.filter((option) => {
        const haystack = `${option.label} ${option.keywords ?? ''}`.toLowerCase()
        return haystack.includes(q)
      })
    : options
  const visible = matched.slice(0, VISIBLE_LIMIT)
  if (selectedValue && !visible.some((option) => option.value === selectedValue)) {
    const selected = options.find((option) => option.value === selectedValue)
    if (selected) visible.unshift(selected)
  }
  return {
    visible,
    matchCount: matched.length,
    truncated: matched.length > visible.length,
  }
}

function FilterSelect({
  label,
  value,
  onValueChange,
  children,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger size="sm" aria-label={label}>
        <span className="text-muted-foreground">{label}</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>{children}</SelectGroup>
      </SelectContent>
    </Select>
  )
}

function FilterSearchSelect({
  label,
  value,
  options,
  searchPlaceholder,
  onValueChange,
}: {
  label: string
  value: string
  options: FilterOption[]
  searchPlaceholder: string
  onValueChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = options.find((option) => option.value === value) ?? ALL_OPTION
  const { visible, matchCount, truncated } = filterOptions(options, query, value)

  function choose(next: string) {
    onValueChange(next)
    setQuery('')
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={label} className="font-normal">
          <span className="text-muted-foreground">{label}</span>
          {selected.label}
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-1 gap-1"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const input = event.currentTarget.querySelector('input')
          input?.focus()
        }}
      >
        <InputGroup>
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const first = visible.find((option) => option.value !== 'all') ?? visible[0]
              if (first) choose(first.value)
            }}
            aria-label={searchPlaceholder}
          />
        </InputGroup>
        <div className="max-h-64 overflow-auto" role="listbox" aria-label={label}>
          <div className="flex flex-col p-0.5">
            {visible.length === 0 ? (
              <p className="px-1.5 py-2 text-center text-sm text-muted-foreground">No matches</p>
            ) : (
              visible.map((option) => {
                const isSelected = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      'relative flex w-full cursor-default items-center rounded-md py-1 pr-8 pl-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent',
                      isSelected && 'bg-accent',
                    )}
                    onClick={() => choose(option.value)}
                  >
                    {option.label}
                    {isSelected ? (
                      <Check className="pointer-events-none absolute right-2" />
                    ) : null}
                  </button>
                )
              })
            )}
          </div>
        </div>
        {truncated ? (
          <p className="px-1.5 pb-1 text-xs text-muted-foreground">
            Showing {visible.length} of {matchCount}. Type to narrow.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

type StringsFiltersProps = {
  search: StringsSearch
  searchInput: string
  modules: Module[]
  tags: Tag[]
  locales: string[]
  actions?: ReactNode
  onSearchInputChange: (value: string) => void
  onFilter: (updates: Partial<StringsSearch>) => void
  onClear: () => void
  onReviewPublish?: () => void
}

export function StringsFilters({
  search,
  searchInput,
  modules,
  tags,
  locales,
  actions,
  onSearchInputChange,
  onFilter,
  onClear,
  onReviewPublish,
}: StringsFiltersProps) {
  const hasFilters = hasActiveStringFilters(search)
  const moduleOptions = useMemo<FilterOption[]>(
    () => [
      ALL_OPTION,
      ...modules.map((module) => ({
        value: module.id,
        label: module.name,
        keywords: module.slug,
      })),
    ],
    [modules],
  )
  const tagOptions = useMemo<FilterOption[]>(
    () => [
      ALL_OPTION,
      ...tags.map((tag) => ({
        value: tag.id,
        label: tag.name,
      })),
    ],
    [tags],
  )

  function applyStatus(value: string) {
    if (!value || value === STATUS_ALL) {
      onFilter({
        status: undefined,
        has_unpublished_changes: undefined,
        deleted: undefined,
      })
      return
    }
    if (value === 'needs_publish') {
      onFilter({
        status: undefined,
        has_unpublished_changes: true,
        deleted: undefined,
      })
      return
    }
    if (value === 'deleted') {
      onFilter({
        status: undefined,
        has_unpublished_changes: undefined,
        deleted: true,
      })
      return
    }
    onFilter({
      status: value as StringsSearch['status'],
      has_unpublished_changes: undefined,
      deleted: undefined,
    })
  }

  function applyConfidence(value: string) {
    if (!value || value === CONFIDENCE_ALL) {
      onFilter({ max_confidence: undefined })
      return
    }
    if (value === 'low') {
      onFilter({ max_confidence: CONFIDENCE_LOW_MAX })
      return
    }
    onFilter({ max_confidence: CONFIDENCE_REVIEW_MAX })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full max-w-72">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search keys or text…"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            aria-label="Search strings"
          />
          {searchInput ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear search"
                onClick={() => {
                  onSearchInputChange('')
                  onFilter({ q: undefined })
                }}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
        {actions ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Status" value={statusValue(search)} onValueChange={applyStatus}>
          <SelectItem value={STATUS_ALL}>All</SelectItem>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="public">Public</SelectItem>
          <SelectItem value="needs_publish">Needs publish</SelectItem>
          <SelectItem value="deleted">Deleted</SelectItem>
        </FilterSelect>
        {onReviewPublish ? (
          <Button size="sm" variant="outline" onClick={onReviewPublish}>
            <GitCompareArrows data-icon="inline-start" />
            Review publish changes
          </Button>
        ) : null}

        {modules.length > 0 ? (
          <FilterSearchSelect
            label="Module"
            value={search.module ?? 'all'}
            options={moduleOptions}
            searchPlaceholder="Search modules…"
            onValueChange={(value) => onFilter({ module: value === 'all' ? undefined : value })}
          />
        ) : null}

        {tags.length > 0 ? (
          <FilterSearchSelect
            label="Tag"
            value={search.tag ?? 'all'}
            options={tagOptions}
            searchPlaceholder="Search tags…"
            onValueChange={(value) => onFilter({ tag: value === 'all' ? undefined : value })}
          />
        ) : null}

        {locales.length > 0 ? (
          <FilterSelect
            label="Missing"
            value={search.missing_locale ?? 'all'}
            onValueChange={(value) =>
              onFilter({ missing_locale: value === 'all' ? undefined : value })
            }
          >
            <SelectItem value="all">All</SelectItem>
            {locales.map((locale) => (
              <SelectItem key={locale} value={locale}>
                {locale}
              </SelectItem>
            ))}
          </FilterSelect>
        ) : null}

        <FilterSelect
          label="AI"
          value={confidenceValue(search)}
          onValueChange={applyConfidence}
        >
          <SelectItem value={CONFIDENCE_ALL}>Any</SelectItem>
          <SelectItem value="review">Needs review</SelectItem>
          <SelectItem value="low">Low</SelectItem>
        </FilterSelect>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}
