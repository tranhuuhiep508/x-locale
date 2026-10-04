import { CalendarIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
  TIME_PRESETS,
  clearTimeSearch,
  expandDatetimeParam,
  hasActiveTimeFilter,
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

function toDatetimeLocalValue(iso?: string): string {
  if (!iso) return ''
  const normalized = expandDatetimeParam(iso, 'since')
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDatetimeLocalValue(local: string): string | undefined {
  if (!local) return undefined
  const date = new Date(local)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}

export function TimeRangePicker({
  value,
  onChange,
  className,
  placeholder = 'All time',
}: TimeRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [customSince, setCustomSince] = useState(() => toDatetimeLocalValue(value.since))
  const [customUntil, setCustomUntil] = useState(() => toDatetimeLocalValue(value.until))
  const [customError, setCustomError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const synced = syncCustomInputsFromValue(value)
    setCustomSince(synced.since)
    setCustomUntil(synced.until)
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
    const since = fromDatetimeLocalValue(customSince)
    const until = fromDatetimeLocalValue(customUntil)
    if (!since || !until) {
      setCustomError('Choose both start and end.')
      return
    }
    if (new Date(since).getTime() > new Date(until).getTime()) {
      setCustomError('Start must be before end.')
      return
    }
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
    setCustomSince('')
    setCustomUntil('')
    setCustomError(null)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent className="w-80 p-0" align="start">
        <div className="flex flex-col gap-1 p-2">
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
        <div className="border-t p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Absolute range</p>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="time-range-since" className="text-xs">Start</Label>
              <Input
                id="time-range-since"
                type="datetime-local"
                value={customSince}
                onChange={(event) => setCustomSince(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="time-range-until" className="text-xs">End</Label>
              <Input
                id="time-range-until"
                type="datetime-local"
                value={customUntil}
                onChange={(event) => setCustomUntil(event.target.value)}
              />
            </div>
            {customError ? <p className="text-xs text-destructive">{customError}</p> : null}
            <Button type="button" size="sm" onClick={applyCustom}>
              Apply range
            </Button>
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

export function syncCustomInputsFromValue(value: TimeRangeValue) {
  return {
    since: toDatetimeLocalValue(value.since),
    until: toDatetimeLocalValue(value.until),
  }
}

/** @deprecated Use TimeRangePicker */
export { TimeRangePicker as DateRangePicker }
