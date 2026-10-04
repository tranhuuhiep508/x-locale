import { CalendarIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DateRange } from 'react-day-picker'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dateRangeFromParams, dateRangeToParams } from '@/lib/date-range-params'
import { cn } from '@/lib/utils'
import {
  TIME_PRESETS,
  clearTimeSearch,
  hasActiveTimeFilter,
  normalizeTimeSearch,
  timeRangeLabel,
  type TimeSearchInput,
} from '@/lib/time-range'

export type TimeRangeValue = TimeSearchInput

type TimeRangePickerProps = {
  value: TimeRangeValue
  onChange: (value: Partial<TimeRangeValue>) => void
  className?: string
  placeholder?: string
}

export function TimeRangePicker({
  value: rawValue,
  onChange,
  className,
  placeholder = 'All time',
}: TimeRangePickerProps) {
  const value = normalizeTimeSearch(rawValue)
  const [open, setOpen] = useState(false)
  const [customRange, setCustomRange] = useState<DateRange | undefined>(
    () => dateRangeFromParams(value.since, value.until),
  )
  const [calendarMonth, setCalendarMonth] = useState(
    () => customRange?.from ?? customRange?.to ?? new Date(),
  )
  const [customError, setCustomError] = useState<string | null>(null)

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      const range = dateRangeFromParams(value.since, value.until)
      setCustomRange(range)
      setCalendarMonth(range?.from ?? range?.to ?? new Date())
      setCustomError(null)
    }
    setOpen(nextOpen)
  }

  // Keep an open editor in sync with external URL changes (for example Back).
  // Opening itself seeds these values synchronously before Calendar mounts.
  useEffect(() => {
    if (!open) return
    const range = dateRangeFromParams(value.since, value.until)
    setCustomRange(range)
    setCalendarMonth(range?.from ?? range?.to ?? new Date())
    setCustomError(null)
  }, [open, value.period, value.since, value.until])

  const active = hasActiveTimeFilter(value)
  const label = active ? timeRangeLabel(value) : placeholder

  function selectPreset(period: string) {
    onChange({ period, since: undefined, until: undefined, updated_within_days: undefined })
    setCustomError(null)
    setOpen(false)
  }

  function applyCustom() {
    if (!customRange?.from || !customRange.to) {
      setCustomError('Choose a start and end date.')
      return
    }
    if (customRange.from.getTime() > customRange.to.getTime()) {
      setCustomError('Start must be before end.')
      return
    }
    const { since, until } = dateRangeToParams(customRange)
    setCustomError(null)
    onChange({
      period: undefined,
      since,
      until,
      updated_within_days: undefined,
    })
    setOpen(false)
  }

  function handleClear() {
    onChange(clearTimeSearch())
    setCustomRange(undefined)
    setCustomError(null)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-[240px] justify-start text-left font-normal',
            !active && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon data-icon="inline-start" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] p-0" align="start">
        <div className="flex flex-col gap-1 border-b p-2 sm:flex-row sm:items-start">
          <div className="flex min-w-[10rem] flex-col gap-1">
            {TIME_PRESETS.map((preset) => (
              <Button
                key={preset.period}
                type="button"
                variant={value.period === preset.period ? 'secondary' : 'ghost'}
                className="justify-start font-normal"
                onClick={() => selectPreset(preset.period)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="border-t pt-2 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-2">
            <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Absolute range</p>
            <Calendar
              data-testid="time-range-calendar"
              mode="range"
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              selected={customRange}
              onSelect={setCustomRange}
              numberOfMonths={2}
              disabled={{ after: new Date() }}
            />
            {customError ? (
              <p className="px-1 pb-1 text-xs text-destructive">{customError}</p>
            ) : null}
            <div className="border-t p-2">
              <Button type="button" size="sm" className="w-full" onClick={applyCustom}>
                Apply range
              </Button>
            </div>
          </div>
        </div>
        {active ? (
          <div className="border-t p-2">
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={handleClear}>
              Clear time
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}

/** @deprecated Use TimeRangePicker */
export { TimeRangePicker as DateRangePicker }
