import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
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

  function applyPerson() {
    const actor = person.trim()
    setPerson(actor)
    if (actor !== (search.actor ?? '')) onFilter({ actor: actor || undefined })
  }

  return (
    <section
      aria-label="Activity filters"
      className="flex min-w-0 flex-wrap items-center gap-2.5 rounded-xl border border-border/80 bg-card p-3 shadow-xs"
    >
      <InputGroup className="min-w-0 basis-full sm:flex-1 sm:basis-48">
        <InputGroupInput
          aria-label="Filter by person"
          placeholder="Person"
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
      </InputGroup>
      <Select
        value={search.event_type || 'all'}
        onValueChange={(value) => onFilter({ event_type: value === 'all' ? undefined : value })}
      >
        <SelectTrigger
          aria-label="Activity type"
          className="w-[calc(50%-0.25rem)] min-w-0 flex-none sm:w-auto"
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
          className="w-[calc(50%-0.25rem)] min-w-0 flex-none sm:w-auto"
        >
          <SelectValue placeholder="Locale" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">All locales</SelectItem>
            {locales.map((code) => (
              <SelectItem key={code} value={code}>
                {code.toUpperCase()}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <TimeRangePicker
        className="min-w-0 flex-1 basis-0 sm:w-48 sm:flex-none sm:basis-auto"
        value={{ period: search.period, since: search.since, until: search.until }}
        onChange={onFilter}
      />
      {hasActivityFilters(search) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setPerson('')
            onClear()
          }}
        >
          Clear
        </Button>
      ) : null}
    </section>
  )
}
