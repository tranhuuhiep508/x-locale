import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import type {
  ActivityChange,
  ActivityFeedCard,
  ActivityFeedChild,
  ActivityListItem,
} from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { changeDisplayValue, changeFieldLabel } from '@/features/activity/change-labels'
import { batchActivitiesQuery } from '@/lib/queries'
import { Spinner } from '@/components/ui/spinner'
import { reviewBatchTarget } from '@/features/activity/review-batch'
import { batchKindLabel, eventTypeLabel } from '@/features/activity/event-type-labels'
import { formatRelativeTime } from '@/lib/utils'

const VISIBLE_CHANGES = 2
const VISIBLE_CHILD_CHANGES = 2

function ChangeLine({ change }: { change: ActivityChange }) {
  const label =
    change.scope === 'published'
      ? `${changeFieldLabel(change)} (published)`
      : changeFieldLabel(change)
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
    <li className="min-w-0 text-xs wrap-anywhere text-muted-foreground">
      <div className="flex flex-wrap items-baseline gap-1">
        <span className="font-mono break-all text-foreground/80">
          {child.string_key ?? 'string'}
        </span>
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
  const reviewBatch = reviewBatchTarget(card)
  const parts = countParts(card.counts)
  const visibleChanges = card.changed.slice(0, VISIBLE_CHANGES)
  const extraChanges = Math.max(0, card.changed_count - visibleChanges.length)

  if (compact) {
    const stringKey = !isBatch ? card.string_key : null
    const action = reviewBatch ? 'Review this batch' : stringKey ? 'Open string' : 'View activity'
    return (
      <div className="flex min-w-0 items-center gap-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm wrap-anywhere text-foreground" title={card.summary}>
            {card.summary}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {card.actor_label} · {formatRelativeTime(card.created_at)}
            {card.locale ? ` · ${card.locale.toUpperCase()}` : ''}
            {isBatch && parts.length > 0 ? ` · ${parts.join(' · ')}` : ''}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link
            to={
              reviewBatch || stringKey
                ? '/projects/$projectRef/strings'
                : '/projects/$projectRef/activity'
            }
            params={{ projectRef: projectId }}
            search={
              reviewBatch
                ? { batch_id: reviewBatch.batchId, batch_kind: reviewBatch.batchKind }
                : stringKey
                  ? { q: stringKey }
                  : {}
            }
            aria-label={`${action}: ${card.summary}`}
            title={action}
          >
            <ArrowRight />
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg py-4">
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-sm font-medium wrap-anywhere text-foreground">{card.summary}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <Badge variant="outline">
            {isBatch && card.batch_kind
              ? batchKindLabel(card.batch_kind)
              : eventTypeLabel(card.event_type)}
          </Badge>
          <span className="wrap-anywhere">{card.actor_label}</span>
          <span aria-hidden="true">·</span>
          <span>{formatRelativeTime(card.created_at)}</span>
          {card.locale ? <span className="font-mono uppercase">{card.locale}</span> : null}
          {isBatch && parts.length > 0 ? <span>{parts.join(' · ')}</span> : null}
        </div>
      </div>

      {!isBatch && visibleChanges.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1 rounded-md bg-muted/50 p-2.5">
          {visibleChanges.map((change) => (
            <ChangeLine key={changeKey(change)} change={change} />
          ))}
          {extraChanges > 0 && onOpenDetail ? (
            <button
              type="button"
              className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              onClick={() => onOpenDetail(card.id)}
            >
              +{extraChanges} more change{extraChanges === 1 ? '' : 's'}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {isBatch ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? (
              <ChevronDown data-icon="inline-start" />
            ) : (
              <ChevronRight data-icon="inline-start" />
            )}
            {open ? 'Hide strings' : `Show ${card.children_count} strings`}
          </Button>
        ) : null}
        {reviewBatch ? (
          <Button variant="ghost" size="sm" asChild>
            <Link
              to="/projects/$projectRef/strings"
              params={{ projectRef: projectId }}
              search={{ batch_id: reviewBatch.batchId, batch_kind: reviewBatch.batchKind }}
            >
              Review this batch
            </Link>
          </Button>
        ) : null}
        {!isBatch && card.string_key ? (
          <Button variant="ghost" size="sm" asChild>
            <Link
              to="/projects/$projectRef/strings"
              params={{ projectRef: projectId }}
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
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => onUndo(card)}>
            <RotateCcw data-icon="inline-start" />
            Undo
          </Button>
        ) : null}
      </div>
      {isBatch && open && card.batch_id ? (
        <BatchChildrenList
          projectId={projectId}
          batchId={card.batch_id}
          childrenCount={card.children_count}
          onOpenDetail={onOpenDetail}
        />
      ) : null}
    </div>
  )
}
