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
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CONFIDENCE_LOW_MAX, CONFIDENCE_REVIEW_MAX } from '@/features/strings/confidence'
import type { Module, Tag } from '@/lib/api/types'
import type { StringsSearch } from '@/lib/schemas'
import { cn } from '@/lib/utils'

const STATUS_ALL = 'all'
const CONFIDENCE_ALL = 'all'
const UNASSIGNED_MODULE = 'unassigned'
const UNTAGGED = 'untagged'
const TRANSLATION_ALL = 'all'
const MISSING_ANY = 'missing:any'
const UPDATED_ALL = 'all'

function statusValue(search: StringsSearch) {
  if (search.deleted) return 'deleted'
  if (search.pending_delete) return 'pending_delete'
  if (search.never_published) return 'never_published'
  if (search.has_unpublished_changes) return 'needs_publish'
  return search.status ?? STATUS_ALL
}

function translationValue(search: StringsSearch) {
  if (search.missing_any) return MISSING_ANY
  if (search.missing_locale) return `missing:${search.missing_locale}`
  if (search.complete_locale) return `complete:${search.complete_locale}`
  return TRANSLATION_ALL
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
      search.unassigned_module ||
      search.tag ||
      search.untagged ||
      search.status ||
      search.missing_locale ||
      search.missing_any ||
      search.complete_locale ||
      search.has_unpublished_changes ||
      search.pending_delete ||
      search.never_published ||
      search.deleted ||
      search.max_confidence != null ||
      search.updated_within_days != null,
  )
}

export function statusFilterUpdates(value: string): Partial<StringsSearch> {
  const cleared = {
    status: undefined,
    has_unpublished_changes: undefined,
    pending_delete: undefined,
    never_published: undefined,
    deleted: undefined,
  }
  if (!value || value === STATUS_ALL) return cleared
  if (value === 'needs_publish') return { ...cleared, has_unpublished_changes: true }
  if (value === 'pending_delete') return { ...cleared, pending_delete: true }
  if (value === 'never_published') return { ...cleared, never_published: true }
  if (value === 'deleted') return { ...cleared, deleted: true }
  return { ...cleared, status: value as StringsSearch['status'] }
}

export function moduleFilterUpdates(value: string): Partial<StringsSearch> {
  return {
    module: value === 'all' || value === UNASSIGNED_MODULE ? undefined : value,
    unassigned_module: value === UNASSIGNED_MODULE ? true : undefined,
  }
}

export function tagFilterUpdates(value: string): Partial<StringsSearch> {
  return {
    tag: value === 'all' || value === UNTAGGED ? undefined : value,
    untagged: value === UNTAGGED ? true : undefined,
  }
}

export function translationFilterUpdates(value: string): Partial<StringsSearch> {
  const cleared = {
    missing_any: undefined,
    missing_locale: undefined,
    complete_locale: undefined,
  }
  if (value === MISSING_ANY) return { ...cleared, missing_any: true }
  if (value.startsWith('missing:')) {
    return { ...cleared, missing_locale: value.slice('missing:'.length) }
  }
  if (value.startsWith('complete:')) {
    return { ...cleared, complete_locale: value.slice('complete:'.length) }
  }
  return cleared
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
          const target = event.currentTarget as HTMLElement | null
          const input = target?.querySelector('input')
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
      { value: UNASSIGNED_MODULE, label: 'Unassigned' },
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
      { value: UNTAGGED, label: 'Untagged' },
      ...tags.map((tag) => ({
        value: tag.id,
        label: tag.name,
      })),
    ],
    [tags],
  )

  function applyStatus(value: string) {
    onFilter(statusFilterUpdates(value))
  }

  function applyModule(value: string) {
    onFilter(moduleFilterUpdates(value))
  }

  function applyTag(value: string) {
    onFilter(tagFilterUpdates(value))
  }

  function applyTranslation(value: string) {
    onFilter(translationFilterUpdates(value))
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
          <SelectItem value="never_published">Never published</SelectItem>
          <SelectItem value="needs_publish">Needs publish</SelectItem>
          <SelectItem value="pending_delete">Pending deletion</SelectItem>
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
            value={search.unassigned_module ? UNASSIGNED_MODULE : (search.module ?? 'all')}
            options={moduleOptions}
            searchPlaceholder="Search modules…"
            onValueChange={applyModule}
          />
        ) : null}

        {tags.length > 0 ? (
          <FilterSearchSelect
            label="Tag"
            value={search.untagged ? UNTAGGED : (search.tag ?? 'all')}
            options={tagOptions}
            searchPlaceholder="Search tags…"
            onValueChange={applyTag}
          />
        ) : null}

        {locales.length > 0 ? (
          <FilterSelect
            label="Translation"
            value={translationValue(search)}
            onValueChange={applyTranslation}
          >
            <SelectItem value={TRANSLATION_ALL}>All translations</SelectItem>
            <SelectItem value={MISSING_ANY}>Missing any target</SelectItem>
            <SelectSeparator />
            <SelectLabel>Missing in locale</SelectLabel>
            {locales.map((locale) => (
              <SelectItem key={`missing-${locale}`} value={`missing:${locale}`}>
                Missing {locale}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectLabel>Complete in locale</SelectLabel>
            {locales.map((locale) => (
              <SelectItem key={`complete-${locale}`} value={`complete:${locale}`}>
                Complete {locale}
              </SelectItem>
            ))}
          </FilterSelect>
        ) : null}

        <FilterSelect
          label="Updated"
          value={search.updated_within_days?.toString() ?? UPDATED_ALL}
          onValueChange={(value) =>
            onFilter({
              updated_within_days:
                value === UPDATED_ALL ? undefined : (Number(value) as 7 | 30),
            })
          }
        >
          <SelectItem value={UPDATED_ALL}>Any time</SelectItem>
          <SelectItem value="7">Last 7 days</SelectItem>
          <SelectItem value="30">Last 30 days</SelectItem>
        </FilterSelect>

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
