import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import type { ActivityChange, ActivityFeedCard, ActivityFeedChild, ActivityListItem } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import { changeDisplayValue, changeFieldLabel } from '@/features/activity/change-labels'
import { batchActivitiesQuery } from '@/lib/queries'
import { Spinner } from '@/components/ui/spinner'
import { formatRelativeTime } from '@/lib/utils'

const VISIBLE_CHANGES = 5
const VISIBLE_CHILD_CHANGES = 2

function ChangeLine({ change }: { change: ActivityChange }) {
  const label = change.scope === 'published' ? `${changeFieldLabel(change)} (published)` : changeFieldLabel(change)
  const before = changeDisplayValue(change, change.before)
  const after = changeDisplayValue(change, change.after)
  if (!change.before) {
    return (
      <p className="truncate text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{label}</span> “{after}”
      </p>
    )
  }
  if (!change.after) {
    return (
      <p className="truncate text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{label}</span> “{before}”
      </p>
    )
  }
  return (
    <p className="truncate text-xs text-muted-foreground">
      <span className="font-medium text-foreground/80">{label}</span> “{before}” → “{after}”
    </p>
  )
}

function changeKey(change: ActivityChange) {
  return `${change.scope}:${change.field}:${change.locale ?? ''}:${change.before}:${change.after}`
}

function countParts(counts: Record<string, number>) {
  const parts: string[] = []
  if (counts.created) parts.push(`+${counts.created} created`)
  if (counts.updated) parts.push(`${counts.updated} updated`)
  if (counts.published) parts.push(`${counts.published} published`)
  if (counts.deleted) parts.push(`${counts.deleted} deleted`)
  return parts
}

function ChildRow({
  child,
  onOpenDetail,
}: {
  child: ActivityFeedChild
  onOpenDetail?: (activityId: string) => void
}) {
  const visible = child.changed.slice(0, VISIBLE_CHILD_CHANGES)
  const extra = Math.max(0, child.changed_count - visible.length)
  return (
    <li className="text-xs text-muted-foreground">
      <div className="flex flex-wrap items-baseline gap-1">
        <span className="font-mono text-foreground/80">{child.string_key ?? 'string'}</span>
        <span>{child.summary}</span>
        {onOpenDetail ? (
          <button
            type="button"
            className="text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => onOpenDetail(child.id)}
          >
            View details
          </button>
        ) : null}
      </div>
      {visible.map((change) => (
        <ChangeLine key={changeKey(change)} change={change} />
      ))}
      {extra > 0 && onOpenDetail ? (
        <button
          type="button"
          className="text-muted-foreground/70 underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => onOpenDetail(child.id)}
        >
          +{extra} more change{extra === 1 ? '' : 's'}
        </button>
      ) : null}
    </li>
  )
}

function listItemToFeedChild(item: ActivityListItem): ActivityFeedChild {
  return {
    id: item.id,
    event_type: item.event_type,
    summary: item.summary,
    string_id: item.string_id,
    string_key: item.string_key,
    locale: item.locale,
    changed: item.changed,
    changed_count: item.changed_count,
  }
}

function BatchChildrenList({
  projectId,
  batchId,
  childrenCount,
  onOpenDetail,
}: {
  projectId: string
  batchId: string
  childrenCount: number
  onOpenDetail?: (activityId: string) => void
}) {
  const { data, isLoading, isError } = useQuery(batchActivitiesQuery(projectId, batchId))

  if (isLoading) {
    return (
      <div className="mt-1 flex items-center gap-2 pl-3 text-xs text-muted-foreground">
        <Spinner className="size-3.5" /> Loading strings…
      </div>
    )
  }
  if (isError) {
    return <p className="mt-1 pl-3 text-xs text-destructive">Could not load batch strings.</p>
  }

  const children = data?.items ?? []
  if (children.length === 0) {
    return <p className="mt-1 pl-3 text-xs text-muted-foreground">No strings in this batch.</p>
  }

  const overflow = childrenCount - children.length

  return (
    <ul className="mt-1 flex flex-col gap-1.5 border-l pl-3">
      {children.map((item) => (
        <ChildRow key={item.id} child={listItemToFeedChild(item)} onOpenDetail={onOpenDetail} />
      ))}
      {overflow > 0 ? (
        <li className="text-xs text-muted-foreground">+{overflow} more strings</li>
      ) : null}
    </ul>
  )
}

export function ActivityCard({
  card,
  projectId,
  compact = false,
  onUndo,
  onOpenDetail,
}: {
  card: ActivityFeedCard
  projectId: string
  compact?: boolean
  onUndo?: (card: ActivityFeedCard) => void
  onOpenDetail?: (activityId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const isBatch = card.kind === 'batch'
  const parts = countParts(card.counts)
  const visibleChanges = card.changed.slice(0, VISIBLE_CHANGES)
  const extraChanges = Math.max(0, card.changed_count - visibleChanges.length)

  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/60">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          <span className="font-medium">{card.actor_label}</span>{' '}
          <span>{card.summary}</span>
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{formatRelativeTime(card.created_at)}</span>
          {card.locale ? (
            <>
              <span>·</span>
              <span className="font-mono uppercase">{card.locale}</span>
            </>
          ) : null}
          {isBatch && parts.length > 0 ? (
            <>
              <span>·</span>
              <span>{parts.join('  ·  ')}</span>
            </>
          ) : null}
        </div>
        {!isBatch ? (
          <>
            {visibleChanges.map((change) => (
              <ChangeLine key={changeKey(change)} change={change} />
            ))}
            {extraChanges > 0 && onOpenDetail ? (
              <button
                type="button"
                className="mt-0.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                onClick={() => onOpenDetail(card.id)}
              >
                +{extraChanges} more change{extraChanges === 1 ? '' : 's'}
              </button>
            ) : null}
          </>
        ) : null}
        {isBatch && !compact ? (
          <div className="mt-1">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {open ? 'Hide strings' : `Show ${card.children_count} strings`}
            </button>
            {open && card.batch_id ? (
              <BatchChildrenList
                projectId={projectId}
                batchId={card.batch_id}
                childrenCount={card.children_count}
                onOpenDetail={onOpenDetail}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!isBatch && card.string_key ? (
          <Button variant="ghost" size="sm" asChild>
            <Link
              to="/projects/$projectId/strings"
              params={{ projectId }}
              search={{ q: card.string_key }}
            >
              Open
            </Link>
          </Button>
        ) : null}
        {!isBatch && onOpenDetail ? (
          <Button variant="ghost" size="sm" onClick={() => onOpenDetail(card.id)}>
            View details
          </Button>
        ) : null}
        {card.is_undoable && onUndo ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-primary"
            onClick={() => onUndo(card)}
          >
            <RotateCcw data-icon="inline-start" />
            Undo
          </Button>
        ) : null}
      </div>
    </div>
  )
}
