import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  FileEdit,
  FileSpreadsheet,
  Globe,
  Languages,
  Layers,
  Plus,
  RotateCcw,
  Sparkles,
  Terminal,
  Trash2,
} from 'lucide-react'
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
import { cn, formatDate, formatRelativeTime } from '@/lib/utils'

const VISIBLE_CHANGES = 2
const VISIBLE_CHILD_CHANGES = 2

interface ActivityVisual {
  icon: LucideIcon
  badgeClass: string
  nodeClass: string
}

const VISUAL_PRESETS = {
  import: {
    icon: FileSpreadsheet,
    badgeClass: 'border-border bg-muted/65 text-foreground/85',
    nodeClass: 'border-border bg-muted text-foreground/85',
  },
  cli: {
    icon: Terminal,
    badgeClass: 'border-border bg-muted/65 text-foreground/85',
    nodeClass: 'border-border bg-muted text-foreground/85',
  },
  ai: {
    icon: Sparkles,
    badgeClass: 'border-primary/25 bg-primary/10 text-primary',
    nodeClass: 'border-primary/35 bg-primary/12 text-primary',
  },
  publish: {
    icon: Globe,
    badgeClass: 'border-primary/25 bg-primary/10 text-primary',
    nodeClass: 'border-primary/35 bg-primary/12 text-primary',
  },
  revert: {
    icon: RotateCcw,
    badgeClass: 'border-border bg-muted/65 text-foreground/85',
    nodeClass: 'border-border bg-muted text-foreground/85',
  },
  danger: {
    icon: Trash2,
    badgeClass: 'border-destructive/30 bg-destructive/10 text-destructive',
    nodeClass: 'border-destructive/35 bg-destructive/15 text-destructive',
  },
  create: {
    icon: Plus,
    badgeClass: 'border-border bg-muted/65 text-foreground/85',
    nodeClass: 'border-border bg-muted text-foreground/85',
  },
  translation: {
    icon: Languages,
    badgeClass: 'border-primary/25 bg-primary/8 text-primary',
    nodeClass: 'border-primary/35 bg-primary/12 text-primary',
  },
  batch: {
    icon: Layers,
    badgeClass: 'border-border bg-muted/70 text-foreground/85',
    nodeClass: 'border-border bg-muted text-foreground/80',
  },
  edit: {
    icon: FileEdit,
    badgeClass: 'border-border bg-muted/60 text-foreground/80',
    nodeClass: 'border-border bg-muted/80 text-foreground/75',
  },
} satisfies Record<string, ActivityVisual>

const VISUAL_BY_KEY: Record<string, ActivityVisual> = {
  import: VISUAL_PRESETS.import,
  excel_import: VISUAL_PRESETS.import,
  cli_push: VISUAL_PRESETS.cli,
  translate: VISUAL_PRESETS.ai,
  'string.published': VISUAL_PRESETS.publish,
  'string.saved_and_published': VISUAL_PRESETS.publish,
  revert: VISUAL_PRESETS.revert,
  snapshot_restore: VISUAL_PRESETS.revert,
  'string.restored': VISUAL_PRESETS.revert,
  'string.pending_delete': VISUAL_PRESETS.danger,
  'string.deleted': VISUAL_PRESETS.danger,
  'string.unpublished': VISUAL_PRESETS.danger,
  'string.created': VISUAL_PRESETS.create,
  'translation.updated': VISUAL_PRESETS.translation,
  batch: VISUAL_PRESETS.batch,
}

export function activityVisualMeta(card: ActivityFeedCard): ActivityVisual {
  if (card.kind === 'batch' && card.batch_kind && VISUAL_BY_KEY[card.batch_kind]) {
    return VISUAL_BY_KEY[card.batch_kind]
  }
  return VISUAL_BY_KEY[card.event_type] ?? (card.kind === 'batch' ? VISUAL_PRESETS.batch : VISUAL_PRESETS.edit)
}

function ChangeLine({ change }: { change: ActivityChange }) {
  const label =
    change.scope === 'published'
      ? `${changeFieldLabel(change)} (published)`
      : changeFieldLabel(change)
  const before = changeDisplayValue(change, change.before)
  const after = changeDisplayValue(change, change.after)

  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span className="inline-flex shrink-0 items-center rounded bg-background/80 px-1.5 py-0.5 text-2xs font-medium text-foreground/80 ring-1 ring-border/70">
        {label}
      </span>
      {!change.before ? (
        <span className="truncate font-mono text-2xs text-foreground/85">“{after}”</span>
      ) : !change.after ? (
        <span className="truncate font-mono text-2xs line-through opacity-75">“{before}”</span>
      ) : (
        <span className="inline-flex min-w-0 flex-wrap items-baseline gap-1 font-mono text-2xs">
          <span className="max-w-full truncate text-muted-foreground line-through decoration-muted-foreground/60">
            “{before}”
          </span>
          <span aria-hidden="true" className="text-muted-foreground/70">
            →
          </span>
          <span className="max-w-full truncate font-medium text-foreground">“{after}”</span>
        </span>
      )}
    </p>
  )
}

function changeKey(change: ActivityChange) {
  return `${change.scope}:${change.field}:${change.locale ?? ''}:${change.before}:${change.after}`
}

interface CountChip {
  label: string
  className: string
}

function countChips(counts: Record<string, number>): CountChip[] {
  const chips: CountChip[] = []
  if (counts.created) {
    chips.push({
      label: `+${counts.created} created`,
      className: 'border-border/80 bg-muted/60 text-foreground/85',
    })
  }
  if (counts.updated) {
    chips.push({
      label: `${counts.updated} updated`,
      className: 'border-border/80 bg-muted/60 text-foreground/80',
    })
  }
  if (counts.published) {
    chips.push({
      label: `${counts.published} published`,
      className: 'border-primary/25 bg-primary/8 text-primary',
    })
  }
  if (counts.deleted) {
    chips.push({
      label: `${counts.deleted} deleted`,
      className: 'border-destructive/25 bg-destructive/8 text-destructive',
    })
  }
  return chips
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
    <li className="min-w-0 py-1.5 text-xs wrap-anywhere text-muted-foreground first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-2xs break-all text-foreground/90">
          {child.string_key ?? 'string'}
        </span>
        <span className="text-foreground/75">{child.summary}</span>
        {onOpenDetail ? (
          <button
            type="button"
            className="text-muted-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline"
            onClick={() => onOpenDetail(child.id)}
          >
            View details
          </button>
        ) : null}
      </div>
      {visible.length > 0 ? (
        <div className="mt-1.5 flex flex-col gap-1 pl-1">
          {visible.map((change) => (
            <ChangeLine key={changeKey(change)} change={change} />
          ))}
        </div>
      ) : null}
      {extra > 0 && onOpenDetail ? (
        <button
          type="button"
          className="mt-1 pl-1 text-muted-foreground/80 underline-offset-2 transition-colors hover:text-foreground hover:underline"
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
      <div className="mt-1 flex items-center gap-2 rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" /> Loading strings…
      </div>
    )
  }
  if (isError) {
    return (
      <p className="mt-1 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        Could not load batch strings.
      </p>
    )
  }

  const children = data?.items ?? []
  if (children.length === 0) {
    return <p className="mt-1 pl-3 text-xs text-muted-foreground">No strings in this batch.</p>
  }

  const overflow = childrenCount - children.length

  return (
    <ul className="mt-1 flex flex-col divide-y divide-border/50 rounded-md border border-border/65 bg-muted/20 px-3 py-2.5">
      {children.map((item) => (
        <ChildRow key={item.id} child={listItemToFeedChild(item)} onOpenDetail={onOpenDetail} />
      ))}
      {overflow > 0 ? (
        <li className="pt-2 font-mono text-2xs text-muted-foreground">+{overflow} more strings</li>
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
  const chips = countChips(card.counts)
  const visibleChanges = card.changed.slice(0, VISIBLE_CHANGES)
  const extraChanges = Math.max(0, card.changed_count - visibleChanges.length)
  const visual = activityVisualMeta(card)
  const KindIcon = visual.icon

  if (compact) {
    const stringKey = !isBatch ? card.string_key : null
    const action = reviewBatch ? 'Review this batch' : stringKey ? 'Open string' : 'View activity'
    const compactCounts = chips.map((chip) => chip.label)
    return (
      <div className="flex min-w-0 items-center gap-3 py-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md border',
            visual.nodeClass
          )}
        >
          <KindIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm wrap-anywhere text-foreground" title={card.summary}>
            {card.summary}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {card.actor_label} · {formatRelativeTime(card.created_at)}
            {card.locale ? ` · ${card.locale.toUpperCase()}` : ''}
            {isBatch && compactCounts.length > 0 ? ` · ${compactCounts.join(' · ')}` : ''}
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

  const kindLabel =
    isBatch && card.batch_kind ? batchKindLabel(card.batch_kind) : eventTypeLabel(card.event_type)

  return (
    <div className="group/activity relative flex min-w-0 flex-col gap-3 rounded-lg border border-border/80 bg-card p-3.5 shadow-2xs transition-colors hover:border-border sm:p-4">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge
              variant="outline"
              className={cn('gap-1.5 font-medium', visual.badgeClass)}
            >
              <KindIcon className="size-3" aria-hidden="true" />
              {kindLabel}
            </Badge>
            {card.locale ? (
              <Badge variant="secondary" className="font-mono text-3xs uppercase">
                {card.locale}
              </Badge>
            ) : null}
            {isBatch && chips.length > 0
              ? chips.map((chip) => (
                  <span
                    key={chip.label}
                    className={cn(
                      'inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-2xs tabular-nums',
                      chip.className
                    )}
                  >
                    {chip.label}
                  </span>
                ))
              : null}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground/85 wrap-anywhere">{card.actor_label}</span>
            <span aria-hidden="true" className="text-border">
              /
            </span>
            <time
              dateTime={card.created_at ?? undefined}
              title={formatDate(card.created_at)}
              className="font-mono text-2xs tabular-nums"
            >
              {formatRelativeTime(card.created_at)}
            </time>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm leading-snug font-medium wrap-anywhere text-foreground">
            {card.summary}
          </p>
          {!isBatch && card.string_key ? (
            <span className="max-w-full truncate rounded-md border border-border/70 bg-muted/45 px-2 py-0.5 font-mono text-2xs text-foreground/80">
              {card.string_key}
            </span>
          ) : null}
        </div>
      </div>

      {!isBatch && visibleChanges.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border/65 bg-muted/30 px-3 py-2.5">
          {visibleChanges.map((change) => (
            <ChangeLine key={changeKey(change)} change={change} />
          ))}
          {extraChanges > 0 && onOpenDetail ? (
            <button
              type="button"
              className="self-start text-xs font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              onClick={() => onOpenDetail(card.id)}
            >
              +{extraChanges} more change{extraChanges === 1 ? '' : 's'}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-border/55 pt-2.5">
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
            {reviewBatch.batchKind === 'cli_push' ? (
              <Link
                to="/projects/$projectRef/batches/$batchId"
                params={{ projectRef: projectId, batchId: reviewBatch.batchId }}
              >
                Review this batch
              </Link>
            ) : (
              <Link
                to="/projects/$projectRef/strings"
                params={{ projectRef: projectId }}
                search={{ batch_id: reviewBatch.batchId, batch_kind: reviewBatch.batchKind }}
              >
                Review this batch
              </Link>
            )}
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
