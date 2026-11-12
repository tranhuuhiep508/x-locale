import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { Separator } from '@/components/ui/separator'
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
    search.saved_string ||
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
  isActive,
  onValueChange,
  children,
}: {
  label: string
  value: string
  isActive?: boolean
  onValueChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'h-8 max-w-full min-w-0 text-xs font-normal gap-1 px-2.5 rounded-lg border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0',
          isActive && 'border-primary/40 bg-primary/5 text-primary font-medium hover:bg-primary/10'
        )}
      >
        {isActive ? (
          <>
            <span className="text-muted-foreground/80 font-normal">{label}:</span>
            <SelectValue />
          </>
        ) : (
          <>
            <span className="font-normal text-muted-foreground">{label}</span>
            <span className="sr-only">
              <SelectValue />
            </span>
          </>
        )}
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
  isActive,
  onValueChange,
}: {
  label: string
  value: string
  options: FilterOption[]
  searchPlaceholder: string
  isActive?: boolean
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
        <Button
          variant="outline"
          aria-label={label}
          size="sm"
          className={cn(
            'h-8 max-w-full min-w-0 text-xs font-normal gap-1 px-2.5 rounded-lg border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0',
            isActive && 'border-primary/40 bg-primary/5 text-primary font-medium hover:bg-primary/10'
          )}
        >
          {isActive ? (
            <>
              <span className="text-muted-foreground/80 font-normal">{label}:</span>
              <span className="max-w-32 truncate font-medium text-foreground">{selected.label}</span>
            </>
          ) : (
            <span className="font-normal text-muted-foreground">{label}</span>
          )}
          <ChevronDown data-icon="inline-end" className="size-3.5 opacity-60 ml-0.5" />
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
            <Search className="size-3.5 text-muted-foreground" />
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
              <p className="px-1.5 py-2 text-center text-xs text-muted-foreground">No matches</p>
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
                      'relative flex w-full cursor-default items-center rounded-md py-1.5 pr-8 pl-2 text-left text-xs outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent',
                      isSelected && 'bg-accent font-medium text-accent-foreground'
                    )}
                    onClick={() => choose(option.value)}
                  >
                    <span className="min-w-0 wrap-anywhere">{option.label}</span>
                    {isSelected ? (
                      <Check className="pointer-events-none absolute right-2 size-3.5 text-primary" />
                    ) : null}
                  </button>
                )
              })
            )}
          </div>
        </div>
        {truncated ? (
          <p className="px-1.5 pb-1 text-[11px] text-muted-foreground">
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
  const hasFilters = hasActiveStringFilters(search)
  const status = statusValue(search)
  const translation = translationValue(search)
  const confidence = confidenceValue(search)

  const isStatusActive = status !== STATUS_ALL
  const isModuleActive = Boolean(search.module || search.unassigned_module)
  const isTagActive = Boolean(search.tag || search.untagged)
  const isTranslationActive = translation !== TRANSLATION_ALL
  const isTimeActive = hasActiveTimeFilter(search)
  const isConfidenceActive = search.max_confidence != null

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
  if (search.q || search.saved_string)
    activeChips.push({
      id: 'search',
      label: search.saved_string ? 'Saved string' : `Search: ${search.q}`,
      updates: { q: undefined },
    })

  if (isStatusActive)
    activeChips.push({
      id: 'status',
      label: STATUS_LABELS[status] ?? status,
      updates: statusFilterUpdates(STATUS_ALL),
    })

  if (isModuleActive) {
    const name = search.unassigned_module
      ? 'Unassigned'
      : (modules.find((module) => module.id === search.module)?.name ?? search.module)
    activeChips.push({
      id: 'module',
      label: `Module: ${name}`,
      updates: moduleFilterUpdates('all'),
    })
  }

  if (isTagActive) {
    const name = search.untagged
      ? 'Untagged'
      : (tags.find((tag) => tag.id === search.tag)?.name ?? search.tag)
    activeChips.push({ id: 'tag', label: `Tag: ${name}`, updates: tagFilterUpdates('all') })
  }

  if (isTranslationActive) {
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

  if (isTimeActive)
    activeChips.push({ id: 'time', label: timeRangeLabel(search), updates: clearTimeSearch() })

  if (isConfidenceActive) {
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

  return (
    <section aria-label="String filters" className="flex min-w-0 flex-col gap-2">
      {/* Compact Single-Row Filter Bar */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <InputGroup data-tour="search" className="min-w-0 flex-1 sm:max-w-xs md:max-w-sm">
          <InputGroupInput
            placeholder="Search keys or text…"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
            aria-label="Search strings"
            className="h-8 text-xs"
          />
          <InputGroupAddon>
            <Search className="size-3.5 text-muted-foreground" />
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
                <X className="size-3" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>

        <Separator orientation="vertical" className="hidden h-5 sm:block mx-0.5 text-border/60" />

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 min-w-0">
          <FilterSelect
            label="Status"
            value={status}
            isActive={isStatusActive}
            onValueChange={applyStatus}
          >
            <SelectItem value={STATUS_ALL}>All</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </FilterSelect>

          {modules.length > 0 || search.module || search.unassigned_module ? (
            <span data-tour="modules" className="inline-flex shrink-0">
              <FilterSearchSelect
                label="Module"
                value={search.unassigned_module ? UNASSIGNED_MODULE : (search.module ?? 'all')}
                options={moduleOptions}
                searchPlaceholder="Search modules…"
                isActive={isModuleActive}
                onValueChange={applyModule}
              />
            </span>
          ) : null}

          {tags.length > 0 || search.tag || search.untagged ? (
            <FilterSearchSelect
              label="Tag"
              value={search.untagged ? UNTAGGED : (search.tag ?? 'all')}
              options={tagOptions}
              searchPlaceholder="Search tags…"
              isActive={isTagActive}
              onValueChange={applyTag}
            />
          ) : null}

          {locales.length > 0 ? (
            <FilterSelect
              label="Translation"
              value={translation}
              isActive={isTranslationActive}
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

          <span data-tour="time-filter" className="inline-flex shrink-0">
            <TimeRangePicker
              placeholder="Time"
              className={cn(
                'h-8 text-xs max-w-full w-auto gap-1 px-2.5 rounded-lg border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors',
                isTimeActive &&
                  'border-primary/40 bg-primary/5 text-primary font-medium hover:bg-primary/10'
              )}
              value={{
                period: search.period,
                since: search.since,
                until: search.until,
                updated_within_days: search.updated_within_days,
              }}
              onChange={(updates) => onFilter(updates)}
            />
          </span>

          <FilterSelect
            label="AI"
            value={confidence}
            isActive={isConfidenceActive}
            onValueChange={applyConfidence}
          >
            <SelectItem value={CONFIDENCE_ALL}>Any</SelectItem>
            <SelectItem value="review">Needs review</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            {confidence.startsWith('threshold:') ? (
              <SelectItem value={confidence}>≤ {search.max_confidence}</SelectItem>
            ) : null}
          </FilterSelect>

          {onReviewPublish ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onReviewPublish}
              className="h-8 text-xs gap-1.5 shrink-0 border-primary/30 text-primary hover:bg-primary/10"
            >
              <GitCompareArrows data-icon="inline-start" className="size-3.5" />
              Review publish changes
            </Button>
          ) : null}

          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-8 text-xs text-muted-foreground hover:text-foreground px-2 shrink-0"
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {/* Active Filter Badges (Only shown when criteria are active) */}
      {hasFilters ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] font-medium text-muted-foreground shrink-0">
            Active:
          </span>
          <ul
            aria-label="Active filters"
            className="flex min-w-0 flex-wrap items-center gap-1.5"
          >
            {activeChips.map((chip) => (
              <li key={chip.id} className="min-w-0 max-w-full shrink-0">
                <Badge
                  variant="secondary"
                  asChild
                  className="h-6 max-w-full gap-1 border border-border/70 bg-secondary/80 text-secondary-foreground transition-colors hover:border-primary/40 hover:bg-accent px-2 py-0 text-xs"
                >
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
                    <span className="min-w-0 max-w-64 truncate text-[11px] font-normal">
                      {chip.label}
                    </span>
                    <X data-icon="inline-end" className="size-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
