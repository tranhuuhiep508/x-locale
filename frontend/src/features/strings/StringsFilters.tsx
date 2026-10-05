import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, GitCompareArrows, Search, SlidersHorizontal, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
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
import { batchFilterChipLabel } from '@/features/strings/batch-filter'
import { CONFIDENCE_LOW_MAX, CONFIDENCE_REVIEW_MAX } from '@/features/strings/confidence'
import type { Module, Tag } from '@/lib/api/types'
import { TimeRangePicker } from '@/components/ui/time-range-picker'
import type { StringsSearch } from '@/lib/schemas'
import { clearTimeSearch, hasActiveTimeFilter, timeRangeLabel } from '@/lib/time-range'
import { cn } from '@/lib/utils'

const STATUS_ALL = 'all'
const CONFIDENCE_ALL = 'all'
const UNASSIGNED_MODULE = 'unassigned'
const UNTAGGED = 'untagged'
const TRANSLATION_ALL = 'all'
const MISSING_ANY = 'missing:any'
const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  public: 'Public',
  never_published: 'Never published',
  needs_publish: 'Needs publish',
  pending_delete: 'Pending deletion',
  deleted: 'Deleted',
}
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
  if (search.max_confidence != null) return `threshold:${search.max_confidence}`
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
    hasActiveTimeFilter(search) ||
    search.batch_id
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
      <SelectTrigger aria-label={label} className="max-w-full min-w-0">
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
        <Button variant="outline" aria-label={label} className="max-w-full min-w-0">
          <span className="text-muted-foreground">{label}</span>
          <span className="max-w-40 truncate font-normal">{selected.label}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-w-[calc(100vw-2rem)] w-64 gap-1 p-1"
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
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
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
                      isSelected && 'bg-accent'
                    )}
                    onClick={() => choose(option.value)}
                  >
                    <span className="min-w-0 wrap-anywhere">{option.label}</span>
                    {isSelected ? <Check className="pointer-events-none absolute right-2" /> : null}
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
  onSearchInputChange,
  onFilter,
  onClear,
  onReviewPublish,
}: StringsFiltersProps) {
  const [filtersOpen, setFiltersOpen] = useState(false)
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
    [modules]
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
    [tags]
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
    if (value.startsWith('threshold:')) {
      onFilter({ max_confidence: Number(value.slice('threshold:'.length)) })
      return
    }
    if (value === 'low') {
      onFilter({ max_confidence: CONFIDENCE_LOW_MAX })
      return
    }
    onFilter({ max_confidence: CONFIDENCE_REVIEW_MAX })
  }

  const activeChips: { id: string; label: string; updates: Partial<StringsSearch> }[] = []
  if (search.q)
    activeChips.push({ id: 'search', label: `Search: ${search.q}`, updates: { q: undefined } })
  const status = statusValue(search)
  if (status !== STATUS_ALL)
    activeChips.push({
      id: 'status',
      label: STATUS_LABELS[status] ?? status,
      updates: statusFilterUpdates(STATUS_ALL),
    })
  if (search.module || search.unassigned_module) {
    const name = search.unassigned_module
      ? 'Unassigned'
      : (modules.find((module) => module.id === search.module)?.name ?? search.module)
    activeChips.push({
      id: 'module',
      label: `Module: ${name}`,
      updates: moduleFilterUpdates('all'),
    })
  }
  if (search.tag || search.untagged) {
    const name = search.untagged
      ? 'Untagged'
      : (tags.find((tag) => tag.id === search.tag)?.name ?? search.tag)
    activeChips.push({ id: 'tag', label: `Tag: ${name}`, updates: tagFilterUpdates('all') })
  }
  const translation = translationValue(search)
  const confidence = confidenceValue(search)
  if (translation !== TRANSLATION_ALL) {
    const label = search.missing_any
      ? 'Missing any target'
      : search.missing_locale
        ? `Missing ${search.missing_locale}`
        : `Complete ${search.complete_locale}`
    activeChips.push({
      id: 'translation',
      label,
      updates: translationFilterUpdates(TRANSLATION_ALL),
    })
  }
  if (hasActiveTimeFilter(search))
    activeChips.push({ id: 'time', label: timeRangeLabel(search), updates: clearTimeSearch() })
  if (search.max_confidence != null) {
    const label =
      confidenceValue(search) === 'low'
        ? 'Low AI confidence'
        : confidenceValue(search) === 'review'
          ? 'AI needs review'
          : `AI confidence ≤ ${search.max_confidence}`
    activeChips.push({ id: 'confidence', label, updates: { max_confidence: undefined } })
  }
  if (search.batch_id)
    activeChips.push({
      id: 'batch',
      label: batchFilterChipLabel(search.batch_kind),
      updates: { batch_id: undefined, batch_kind: undefined },
    })
  const refinementCount = activeChips.filter((chip) => chip.id !== 'search').length

  return (
    <section
      aria-label="String filters"
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="min-w-0 flex-1 md:basis-56">
          <InputGroupInput
            placeholder="Search keys or text…"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            aria-label="Search strings"
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
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
        <Button
          variant="outline"
          className="md:hidden"
          aria-expanded={filtersOpen}
          aria-controls="string-filters string-review-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal data-icon="inline-start" />
          Filters
          {refinementCount > 0 ? <Badge variant="secondary">{refinementCount}</Badge> : null}
        </Button>

        <div
          id="string-filters"
          className={cn(
            'flex w-full min-w-0 flex-wrap items-center gap-2 md:w-auto',
            !filtersOpen && 'hidden md:flex'
          )}
        >
          <FilterSelect label="Status" value={status} onValueChange={applyStatus}>
            <SelectItem value={STATUS_ALL}>All</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </FilterSelect>
          {modules.length > 0 || search.module || search.unassigned_module ? (
            <FilterSearchSelect
              label="Module"
              value={search.unassigned_module ? UNASSIGNED_MODULE : (search.module ?? 'all')}
              options={moduleOptions}
              searchPlaceholder="Search modules…"
              onValueChange={applyModule}
            />
          ) : null}
          {tags.length > 0 || search.tag || search.untagged ? (
            <FilterSearchSelect
              label="Tag"
              value={search.untagged ? UNTAGGED : (search.tag ?? 'all')}
              options={tagOptions}
              searchPlaceholder="Search tags…"
              onValueChange={applyTag}
            />
          ) : null}
        </div>
      </div>

      <div
        id="string-review-filters"
        className={cn(
          'flex min-w-0 flex-wrap items-center gap-2',
          !filtersOpen && 'hidden md:flex'
        )}
      >
        <Separator />
        <span className="sr-only md:not-sr-only md:mr-1 md:text-xs md:font-medium md:text-muted-foreground">
          Refine
        </span>
        {locales.length > 0 ? (
          <FilterSelect label="Translation" value={translation} onValueChange={applyTranslation}>
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
        <TimeRangePicker
          className="max-w-full w-auto"
          value={{
            period: search.period,
            since: search.since,
            until: search.until,
            updated_within_days: search.updated_within_days,
          }}
          onChange={(updates) => onFilter(updates)}
        />
        <FilterSelect label="AI" value={confidence} onValueChange={applyConfidence}>
          <SelectItem value={CONFIDENCE_ALL}>Any</SelectItem>
          <SelectItem value="review">Needs review</SelectItem>
          <SelectItem value="low">Low</SelectItem>
          {confidence.startsWith('threshold:') ? (
            <SelectItem value={confidence}>≤ {search.max_confidence}</SelectItem>
          ) : null}
        </FilterSelect>
      </div>

      {hasFilters || onReviewPublish ? (
        <>
          <Separator />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ul
              aria-label="Active filters"
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible"
            >
              {activeChips.map((chip) => (
                <li key={chip.id} className="min-w-0 max-w-full shrink-0">
                  <Badge variant="secondary" asChild className="h-7 max-w-full">
                    <button
                      type="button"
                      title={chip.label}
                      aria-label={
                        chip.id === 'batch' ? 'Clear batch filter' : `Remove ${chip.id} filter`
                      }
                      onClick={() => {
                        if (chip.id === 'search') onSearchInputChange('')
                        onFilter(chip.updates)
                      }}
                    >
                      <span className="min-w-0 max-w-64 truncate">{chip.label}</span>
                      <X data-icon="inline-end" />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
            {onReviewPublish ? (
              <Button variant="outline" size="sm" onClick={onReviewPublish}>
                <GitCompareArrows data-icon="inline-start" />
                Review publish changes
              </Button>
            ) : null}
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={onClear}>
                Clear
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}
