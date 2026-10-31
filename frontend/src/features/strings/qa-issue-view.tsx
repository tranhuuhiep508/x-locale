import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { CircleCheck, OctagonX, TriangleAlert } from 'lucide-react'
import type { QaIssue } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { issueCounts, presentQaIssues, type QaView } from '@/features/strings/qa-issues'
import { cn } from '@/lib/utils'

const warningBadgeClass =
  'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
const warningIconClass = 'text-amber-600 dark:text-amber-400'

/** Long enough for the pointer to cross from the badge into the popover. */
const CLOSE_DELAY_MS = 150

export const QA_SAVE_FOOTER = 'Advisory only. You can still save.'
export const QA_APPLY_FOOTER = 'Advisory only. You can still apply.'

export type QaBadgeIssue = QaIssue & { locale?: string }

export function QaCountBadges({
  errors,
  warnings,
  showClean = true,
}: {
  errors: number
  warnings: number
  showClean?: boolean
}) {
  if (errors === 0 && warnings === 0) {
    if (!showClean) return null
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CircleCheck />
        No QA issues
      </Badge>
    )
  }
  return (
    <>
      {errors > 0 ? (
        <Badge variant="destructive">
          <OctagonX />
          {errors === 1 ? '1 error' : `${errors} errors`}
        </Badge>
      ) : null}
      {warnings > 0 ? (
        <Badge variant="outline" className={warningBadgeClass}>
          <TriangleAlert className={warningIconClass} />
          {warnings === 1 ? '1 warning' : `${warnings} warnings`}
        </Badge>
      ) : null}
    </>
  )
}

function countLabel(errors: number, warnings: number) {
  const total = errors + warnings
  if (errors > 0 && warnings > 0) return `${total} issues`
  if (errors > 0) return errors === 1 ? '1 error' : `${errors} errors`
  return warnings === 1 ? '1 warning' : `${warnings} warnings`
}

function breakdown(errors: number, warnings: number) {
  const parts: string[] = []
  if (errors) parts.push(errors === 1 ? '1 error' : `${errors} errors`)
  if (warnings) parts.push(warnings === 1 ? '1 warning' : `${warnings} warnings`)
  return parts.join(' · ')
}

export function QaChecking() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Spinner className="size-3" role="presentation" aria-hidden="true" />
      Checking…
    </span>
  )
}

export function QaLocaleBadge({
  view,
  locale,
  footer,
  id,
}: {
  view: QaView
  locale: string
  footer: string
  id?: string
}) {
  if (view.status === 'unchecked') return null
  const issues = presentQaIssues(view.issues)
  const live = id ? <QaLiveRegion id={id} view={view} /> : null
  if (issues.length === 0 && view.status === 'checking') return <QaChecking />
  if (issues.length === 0 && view.status === 'failed') {
    return (
      <>
        <span className="text-xs text-muted-foreground">QA failed</span>
        {live}
      </>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {view.status === 'checking' ? <QaChecking /> : null}
      <QaIssueBadge
        label={locale}
        issues={issues}
        footer={footer}
        stale={view.stale}
        showClean={view.status === 'ready'}
      />
      {view.status === 'failed' ? (
        <span className="text-xs text-muted-foreground">QA failed</span>
      ) : null}
      {live}
    </span>
  )
}

/** The textarea's polite announcement. Visually hidden so the badge stays the only QA chrome. */
function QaLiveRegion({ id, view }: { id: string; view: QaView }) {
  if (!describedByFor(view, id)) return null
  const issues = presentQaIssues(view.issues)
  return (
    <div id={id} aria-live="polite" className="sr-only">
      {issues.map((issue, index) => (
        <span key={`${issue.code}-${index}`}>
          {issue.message}{' '}
          <code>{issue.code}</code>
        </span>
      ))}
      {view.status === 'ready' && issues.length === 0 ? <span>No QA issues</span> : null}
      {view.status === 'failed' ? <span>QA check failed.</span> : null}
    </div>
  )
}

/**
 * One badge. Red when any issue is an error, amber for warnings only, grey when clean.
 * Opens on mouse hover, keyboard focus, and click/tap. A click keeps it open.
 */
export function QaIssueBadge({
  label,
  issues,
  footer,
  id,
  stale = false,
  showClean = true,
}: {
  label: string
  issues: readonly QaBadgeIssue[]
  footer: string
  id?: string
  stale?: boolean
  showClean?: boolean
}) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number | undefined>(undefined)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const fromPointer = useRef(false)
  const { errors, warnings } = issueCounts(issues)

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  if (issues.length === 0) {
    if (!showClean) return null
    return (
      <Badge id={id} variant="outline" className="text-muted-foreground">
        <CircleCheck />
        No QA issues
      </Badge>
    )
  }

  const ordered = [...issues].sort((a, b) => (
    a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1
  ))
  const showLocale = ordered.some((issue) => issue.locale)
  const show = () => {
    window.clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const hide = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      const active = document.activeElement
      const focused = active instanceof Node
        && (triggerRef.current?.contains(active) || contentRef.current?.contains(active))
      if (!focused) setOpen(false)
    }, CLOSE_DELAY_MS)
  }
  const onPointer = (event: PointerEvent, next: 'show' | 'hide') => {
    if (event.pointerType !== 'mouse') return
    if (next === 'show') show()
    else hide()
  }
  const onFocus = () => {
    if (!fromPointer.current) show()
  }
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    show()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Badge
          asChild
          variant={errors > 0 ? 'destructive' : 'outline'}
          className={cn('cursor-default', stale && 'opacity-50', errors === 0 && warningBadgeClass)}
        >
          <button
            ref={triggerRef}
            id={id}
            type="button"
            aria-label={`QA for ${label}: ${breakdown(errors, warnings)}. Advisory only.`}
            onPointerDown={() => { fromPointer.current = true }}
            onPointerEnter={(event) => onPointer(event, 'show')}
            onPointerLeave={(event) => onPointer(event, 'hide')}
            onFocus={onFocus}
            onBlur={() => {
              fromPointer.current = false
              hide()
            }}
            onClick={onClick}
          >
            {errors > 0 ? <OctagonX /> : <TriangleAlert className={warningIconClass} />}
            {countLabel(errors, warnings)}
          </button>
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="end"
        side="bottom"
        className="w-80 gap-2"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          const active = document.activeElement
          if (!(active instanceof Node && contentRef.current?.contains(active))) event.preventDefault()
        }}
        onPointerEnter={(event) => onPointer(event, 'show')}
        onPointerLeave={(event) => onPointer(event, 'hide')}
        onFocusCapture={show}
        onBlur={hide}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow min-w-0 truncate">QA · {label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{breakdown(errors, warnings)}</span>
        </div>
        <ul className="flex flex-col gap-2" aria-label={`QA issues for ${label}`}>
          {ordered.map((issue, index) => {
            const error = issue.severity === 'error'
            const Icon = error ? OctagonX : TriangleAlert
            return (
              <li key={`${issue.locale ?? ''}-${issue.code}-${index}`} className="grid grid-cols-[auto_1fr] gap-x-2 text-xs leading-snug">
                <Icon
                  className={cn('mt-px size-3.5', error ? 'text-destructive' : warningIconClass)}
                  aria-label={error ? 'Error' : 'Warning'}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  {showLocale && issue.locale ? (
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">{issue.locale}</span>
                  ) : null}
                  <span className="wrap-anywhere text-foreground">{issue.message}</span>
                  <code className="w-fit rounded bg-muted/60 px-1 py-px font-mono text-[10px] text-muted-foreground" translate="no">
                    {issue.code}
                  </code>
                </span>
              </li>
            )
          })}
        </ul>
        <p className="border-t pt-2 text-xs text-muted-foreground">{footer}</p>
      </PopoverContent>
    </Popover>
  )
}

export function describedByFor(view: QaView, id: string): string | undefined {
  if (view.status === 'unchecked' || view.status === 'checking') {
    return view.issues.length > 0 ? id : undefined
  }
  return id
}
