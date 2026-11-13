import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ExternalLink, InfoIcon, RotateCcwIcon } from 'lucide-react'
import type { ActivityChange } from '@/lib/api/types'
import { activityDetailQuery } from '@/lib/queries'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import {
  changeDisplayValue,
  changeFieldLabel,
  changeScopeLabel,
  groupChangesByScope,
} from '@/features/activity/change-labels'
import { batchKindLabel, eventTypeLabel } from '@/features/activity/event-type-labels'
import { cn, formatDate, formatRelativeTime } from '@/lib/utils'

function ChangeRow({ change }: { change: ActivityChange }) {
  const label = changeFieldLabel(change)
  const isChanged = change.before !== change.after
  return (
    <div className="flex min-w-0 flex-col gap-2.5 px-3.5 py-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground/90">{label}</span>
        {isChanged ? (
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-primary">
            Modified
          </span>
        ) : null}
      </div>
      <div className="grid min-w-0 gap-2.5 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Before
          </span>
          <p className="rounded-md border border-border/70 bg-muted/40 p-2.5 font-mono text-xs whitespace-pre-wrap wrap-anywhere text-muted-foreground">
            {changeDisplayValue(change, change.before)}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-semibold tracking-wider text-primary uppercase">
            After
          </span>
          <p
            className={cn(
              'rounded-md border p-2.5 font-mono text-xs whitespace-pre-wrap wrap-anywhere',
              isChanged
                ? 'border-primary/25 bg-primary/5 font-medium text-foreground'
                : 'border-border/70 bg-muted/40 text-foreground'
            )}
          >
            {changeDisplayValue(change, change.after)}
          </p>
        </div>
      </div>
    </div>
  )
}

function ChangeGroupSection({
  scope,
  changes,
}: {
  scope: ActivityChange['scope']
  changes: ActivityChange[]
}) {
  const translations = changes.filter((change) => change.kind === 'translation')
  const other = changes.filter((change) => change.kind !== 'translation')
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {changeScopeLabel(scope)}
        </h3>
        <div className="h-px flex-1 bg-border/60" />
      </div>
      <div className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-lg border border-border/80 bg-card shadow-2xs">
        {other.map((change) => (
          <ChangeRow key={change.field} change={change} />
        ))}
        {translations.length > 0 && other.length > 0 ? (
          <div className="bg-muted/35 px-3.5 py-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Translations
          </div>
        ) : null}
        {translations.map((change) => (
          <ChangeRow key={`translation:${change.locale}`} change={change} />
        ))}
      </div>
    </div>
  )
}

export function ActivityDetailSheet({
  projectId,
  activityId,
  onOpenChange,
  onRestore,
  restorePending = false,
  onUndo,
  undoPending = false,
  undoLabel = 'Undo',
}: {
  projectId: string
  activityId: string | null
  onOpenChange: (open: boolean) => void
  onRestore?: () => void
  restorePending?: boolean
  onUndo?: () => void
  undoPending?: boolean
  undoLabel?: string
}) {
  const { data: detail, isLoading } = useQuery({
    ...activityDetailQuery(projectId, activityId ?? ''),
    enabled: activityId !== null,
  })

  const groups = detail ? groupChangesByScope(detail.changed) : []

  return (
    <Sheet open={activityId !== null} onOpenChange={(next) => !next && onOpenChange(false)}>
      <SheetContent className="flex flex-col gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="galley-grid shrink-0 border-b bg-card/90 pr-12">
          <SheetTitle className="font-heading leading-snug wrap-anywhere">
            {detail?.summary ?? 'Activity details'}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {detail ? (
              <>
                <span className="font-medium wrap-anywhere text-foreground/85">
                  {detail.actor_label}
                </span>
                <span aria-hidden="true">·</span>
                <span title={formatDate(detail.created_at)}>
                  {formatRelativeTime(detail.created_at)}
                </span>
                <Badge variant="secondary">{eventTypeLabel(detail.event_type)}</Badge>
                {detail.batch_kind ? (
                  <Badge variant="outline">{batchKindLabel(detail.batch_kind)}</Badge>
                ) : null}
              </>
            ) : (
              'Loading…'
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : !detail ? (
            <p className="text-sm text-muted-foreground">Activity not found.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-4 text-sm text-muted-foreground">
                  No field changes recorded for this event.
                </p>
              ) : (
                groups.map((group) => (
                  <ChangeGroupSection
                    key={group.scope}
                    scope={group.scope}
                    changes={group.changes}
                  />
                ))
              )}

              {detail.revert_of ? (
                <div className="flex items-center gap-2 rounded-lg border border-border/75 bg-muted/30 px-3 py-2.5 text-xs wrap-anywhere text-muted-foreground">
                  <RotateCcwIcon className="size-3.5 shrink-0 text-primary" />
                  <span>
                    Reverts:{' '}
                    <span className="font-medium text-foreground">{detail.revert_of.summary}</span>{' '}
                    ({formatRelativeTime(detail.revert_of.created_at)})
                  </span>
                </div>
              ) : null}
              {detail.reverted_by ? (
                <div className="flex items-center gap-2 rounded-lg border border-border/75 bg-muted/30 px-3 py-2.5 text-xs wrap-anywhere text-muted-foreground">
                  <RotateCcwIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span>
                    Reverted by:{' '}
                    <span className="font-medium text-foreground">
                      {detail.reverted_by.summary}
                    </span>{' '}
                    ({formatRelativeTime(detail.reverted_by.created_at)})
                  </span>
                </div>
              ) : null}

              {!detail.is_history_restorable &&
              detail.restore_blocked_reason &&
              (onRestore || detail.string_id) ? (
                <Alert role="note" className="border-border/80 bg-muted/40 py-2.5">
                  <InfoIcon className="size-4 text-muted-foreground" />
                  <AlertDescription className="text-xs text-muted-foreground">
                    {detail.restore_blocked_reason}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          )}
        </div>

        <SheetFooter className="shrink-0 flex-row flex-wrap items-center justify-end gap-2 border-t bg-card/70">
          {detail?.string_key ? (
            <Button variant="ghost" size="sm" asChild>
              <Link
                to="/projects/$projectRef/strings"
                params={{ projectRef: projectId }}
                search={{ q: detail.string_key }}
              >
                <ExternalLink data-icon="inline-start" />
                Open string
              </Link>
            </Button>
          ) : null}
          {onUndo ? (
            <Button variant="outline" size="sm" disabled={undoPending} onClick={onUndo}>
              {undoPending ? <Spinner data-icon="inline-start" /> : null}
              {undoLabel}
            </Button>
          ) : null}
          {onRestore && detail?.is_history_restorable ? (
            <Button size="sm" disabled={restorePending} onClick={onRestore}>
              {restorePending ? <Spinner data-icon="inline-start" /> : null}
              Restore working copy
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
