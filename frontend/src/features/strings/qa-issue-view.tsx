import { CircleCheck, OctagonX, TriangleAlert } from 'lucide-react'
import type { QaIssue } from '@/lib/api/types'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { issueCounts, presentQaIssues, type QaView } from '@/features/strings/qa-issues'
import { cn } from '@/lib/utils'

const warningBadgeClass =
  'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200'
const warningTextClass = 'text-amber-900 dark:text-amber-200'
const warningIconClass = 'text-amber-600 dark:text-amber-400'

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

export function QaChecking() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Spinner className="size-3" role="presentation" aria-hidden="true" />
      Checking…
    </span>
  )
}

export function QaLocaleBadge({ view }: { view: QaView }) {
  if (view.status === 'checking') return <QaChecking />
  if (view.status === 'unchecked') return null
  const { errors, warnings } = issueCounts(presentQaIssues(view.issues))
  if (view.status === 'failed' && errors === 0 && warnings === 0) {
    return <span className="text-xs text-muted-foreground">QA failed</span>
  }
  return (
    <QaCountBadges
      errors={errors}
      warnings={warnings}
      showClean={view.status === 'ready'}
    />
  )
}

export function QaIssueList({
  view,
  id,
}: {
  view: QaView
  id: string
}) {
  const issues = presentQaIssues(view.issues)
  const failed = view.status === 'failed'
  if (view.status === 'unchecked') return null
  if (issues.length === 0 && !failed && view.status !== 'ready') return null
  return (
    <div id={id} aria-live="polite">
      {issues.length > 0 ? (
        <ul className={cn('mt-1.5 flex flex-col gap-1.5', view.stale && 'opacity-50')}>
          {issues.map((issue, index) => (
            <QaIssueRow key={`${issue.code}-${index}`} issue={issue} />
          ))}
        </ul>
      ) : null}
      {view.status === 'ready' && issues.length === 0 ? (
        <span className="sr-only">No QA issues</span>
      ) : null}
      {failed ? (
        <p className="mt-1.5 text-xs text-muted-foreground">QA check failed.</p>
      ) : null}
    </div>
  )
}

function QaIssueRow({ issue }: { issue: QaIssue }) {
  const error = issue.severity === 'error'
  const Icon = error ? OctagonX : TriangleAlert
  return (
    <li
      className={cn(
        'grid grid-cols-[auto_1fr] gap-x-1.5 text-xs leading-snug',
        error ? 'text-destructive' : warningTextClass,
      )}
    >
      <Icon className={cn('mt-0.5 size-3.5', !error && warningIconClass)} />
      <span>
        {issue.message}{' '}
        <code className="rounded bg-muted/60 px-1 py-px font-mono text-[10px] text-muted-foreground">
          {issue.code}
        </code>
      </span>
    </li>
  )
}

export function describedByFor(view: QaView, id: string): string | undefined {
  if (view.status === 'unchecked' || view.status === 'checking') {
    return view.issues.length > 0 ? id : undefined
  }
  return id
}
