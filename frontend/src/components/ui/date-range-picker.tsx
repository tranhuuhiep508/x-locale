import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { type DateRange, type Matcher } from 'react-day-picker'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type DateRangeValue = {
  since?: string
  until?: string
}

function parseDateParam(value?: string): Date | undefined {
  if (!value) return undefined
  const datePart = value.slice(0, 10)
  const [year, month, day] = datePart.split('-').map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function formatDateParam(date: Date, endOfDay = false): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return endOfDay ? `${year}-${month}-${day}T23:59:59` : `${year}-${month}-${day}T00:00:00`
}

export function dateRangeFromParams(since?: string, until?: string): DateRange | undefined {
  const from = parseDateParam(since)
  const to = parseDateParam(until)
  if (!from && !to) return undefined
  return { from, to }
}

export function dateRangeToParams(range: DateRange | undefined): DateRangeValue {
  if (!range?.from) {
    return { since: undefined, until: undefined }
  }
  return {
    since: formatDateParam(range.from),
    until: range.to ? formatDateParam(range.to, true) : undefined,
  }
}

type DateRangePickerProps = {
  value?: DateRangeValue
  onChange: (value: DateRangeValue) => void
  className?: string
  placeholder?: string
  disabled?: Matcher | Matcher[]
}

export function DateRangePicker({
  value,
  onChange,
  className,
  placeholder = 'Pick dates',
  disabled,
}: DateRangePickerProps) {
  const selected = dateRangeFromParams(value?.since, value?.until)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-[240px] justify-start text-left font-normal',
            !selected?.from && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon data-icon="inline-start" />
          {selected?.from ? (
            selected.to ? (
              <>
                {format(selected.from, 'LLL dd, y')} – {format(selected.to, 'LLL dd, y')}
              </>
            ) : (
              format(selected.from, 'LLL dd, y')
            )
          ) : (
            placeholder
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={selected?.from}
          selected={selected}
          onSelect={(range) => onChange(dateRangeToParams(range))}
          numberOfMonths={2}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  )
}
