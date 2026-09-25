import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ActivityChange } from '@/lib/api/types'
import { activityDetailQuery } from '@/lib/queries'
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
import { changeDisplayValue, changeFieldLabel, changeScopeLabel, groupChangesByScope } from '@/features/activity/change-labels'
import { batchKindLabel, eventTypeLabel } from '@/features/activity/event-type-labels'
import { formatDate, formatRelativeTime } from '@/lib/utils'

function ChangeRow({ change }: { change: ActivityChange }) {
  const label = changeFieldLabel(change)
  return (
    <div className="flex flex-col gap-1 px-3 py-2.5 text-xs">
      <span className="font-medium text-foreground/80">{label}</span>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-2">
        <p className="min-w-0 flex-1 rounded-md bg-muted/50 px-2 py-1 whitespace-pre-wrap break-words text-muted-foreground">
          {changeDisplayValue(change, change.before)}
        </p>
        <span className="shrink-0 self-center text-muted-foreground/60">→</span>
        <p className="min-w-0 flex-1 rounded-md bg-muted/50 px-2 py-1 whitespace-pre-wrap break-words text-foreground">
          {changeDisplayValue(change, change.after)}
        </p>
      </div>
    </div>
  )
}

function ChangeGroupSection({ scope, changes }: { scope: ActivityChange['scope']; changes: ActivityChange[] }) {
  const translations = changes.filter((change) => change.kind === 'translation')
  const other = changes.filter((change) => change.kind !== 'translation')
  return (
    <div className="flex flex-col gap-2">
      <h3 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {changeScopeLabel(scope)}
      </h3>
      <div className="flex flex-col divide-y rounded-md border">
        {other.map((change) => (
          <ChangeRow key={change.field} change={change} />
        ))}
        {translations.length > 0 && other.length > 0 ? (
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Translations</div>
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
        <SheetHeader className="border-b">
          <SheetTitle>{detail?.summary ?? 'Activity details'}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {detail ? (
              <>
                <span className="font-medium text-foreground/80">{detail.actor_label}</span>
                <span>·</span>
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

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Spinner />
            </div>
          ) : !detail ? (
            <p className="text-sm text-muted-foreground">Activity not found.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No field changes recorded for this event.</p>
              ) : (
                groups.map((group) => (
                  <ChangeGroupSection key={group.scope} scope={group.scope} changes={group.changes} />
                ))
              )}

              {detail.revert_of ? (
                <p className="text-xs text-muted-foreground">
                  Reverts: {detail.revert_of.summary} ({formatRelativeTime(detail.revert_of.created_at)})
                </p>
              ) : null}
              {detail.reverted_by ? (
                <p className="text-xs text-muted-foreground">
                  Reverted by: {detail.reverted_by.summary} ({formatRelativeTime(detail.reverted_by.created_at)})
                </p>
              ) : null}

              {!detail.is_history_restorable && detail.restore_blocked_reason && (onRestore || detail.string_id) ? (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {detail.restore_blocked_reason}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <SheetFooter className="flex-row justify-end gap-2 border-t">
          {detail?.string_key ? (
            <Button variant="ghost" size="sm" asChild>
              <Link
                to="/projects/$projectId/strings"
                params={{ projectId }}
                search={{ q: detail.string_key }}
              >
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
              Restore this version
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
