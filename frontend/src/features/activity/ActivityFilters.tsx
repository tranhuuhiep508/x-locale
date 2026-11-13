import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Search, X } from 'lucide-react'
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TimeRangePicker } from '@/components/ui/time-range-picker'
import { hasActiveTimeFilter } from '@/lib/time-range'
import type { ActivitySearch } from '@/lib/schemas'
import { EVENT_TYPE_FILTER_OPTIONS } from './event-type-labels'

export function hasActivityFilters(search: ActivitySearch) {
  return Boolean(search.event_type || search.actor || search.locale || hasActiveTimeFilter(search))
}

function localeOptionLabel(code: string, displayNames: Intl.DisplayNames | null): string {
  const upper = code.toUpperCase()
  try {
    const name = displayNames?.of(code)
    return name && name.toLowerCase() !== code.toLowerCase() ? `${upper} · ${name}` : upper
  } catch {
    return upper
  }
}

export function ActivityFilters({
  search,
  locales,
  onFilter,
  onClear,
}: {
  search: ActivitySearch
  locales: string[]
  onFilter: (updates: Partial<ActivitySearch>) => void
  onClear: () => void
}) {
  const [person, setPerson] = useState(search.actor ?? '')
  useEffect(() => {
    setPerson(search.actor ?? '')
  }, [search.actor])

  const displayNames = useMemo(() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' })
    } catch {
      return null
    }
  }, [])

  const filtered = hasActivityFilters(search)

  function applyPerson() {
    const actor = person.trim()
    setPerson(actor)
    if (actor !== (search.actor ?? '')) onFilter({ actor: actor || undefined })
  }

  return (
    <section
      aria-label="Activity filters"
      className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-border/75 bg-background/75 p-2 shadow-2xs"
    >
      <InputGroup className="min-w-0 basis-full bg-card sm:max-w-xs sm:flex-1 sm:basis-48">
        <InputGroupInput
          aria-label="Filter by person"
          placeholder="Filter by person"
          value={person}
          onChange={(event) => setPerson(event.target.value)}
          onBlur={applyPerson}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) applyPerson()
          }}
        />
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        {person ? (
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Clear person filter"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setPerson('')
                if (search.actor) onFilter({ actor: undefined })
              }}
            >
              <X />
            </InputGroupButton>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <Select
        value={search.event_type || 'all'}
        onValueChange={(value) => onFilter({ event_type: value === 'all' ? undefined : value })}
      >
        <SelectTrigger
          aria-label="Activity type"
          className="w-[calc(50%-0.25rem)] min-w-0 flex-none bg-card sm:w-auto"
        >
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {EVENT_TYPE_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={search.locale || 'all'}
        onValueChange={(value) => onFilter({ locale: value === 'all' ? undefined : value })}
      >
        <SelectTrigger
          aria-label="Activity locale"
          className="w-[calc(50%-0.25rem)] min-w-0 flex-none bg-card sm:w-auto"
        >
          <SelectValue placeholder="Locale" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">All locales</SelectItem>
            {locales.map((code) => (
              <SelectItem key={code} value={code}>
                {localeOptionLabel(code, displayNames)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <TimeRangePicker
        className="min-w-0 flex-1 basis-0 bg-card sm:w-52 sm:flex-none sm:basis-auto"
        value={{ period: search.period, since: search.since, until: search.until }}
        onChange={onFilter}
      />
      {filtered ? (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={() => {
            setPerson('')
            onClear()
          }}
        >
          <RotateCcw data-icon="inline-start" />
          Clear
        </Button>
      ) : null}
    </section>
  )
}
