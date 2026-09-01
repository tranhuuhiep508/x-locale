import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import type { ActivityChange, ActivityFeedCard } from '@/lib/api/types'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/utils'

function quote(value: string | null | undefined) {
  if (!value) return '—'
  const trimmed = value.length > 80 ? `${value.slice(0, 77)}…` : value
  return `“${trimmed}”`
}

function ChangeLine({ change }: { change: ActivityChange }) {
  const label = change.locale ?? (change.field === 'source_text' ? 'Source' : change.field)
  if (!change.before) {
    return (
      <p className="truncate text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{label}</span> {quote(change.after)}
      </p>
    )
  }
  if (!change.after) {
    return (
      <p className="truncate text-xs text-muted-foreground">
        <span className="font-medium text-foreground/80">{label}</span> {quote(change.before)}
      </p>
    )
  }
  return (
    <p className="truncate text-xs text-muted-foreground">
      <span className="font-medium text-foreground/80">{label}</span>{' '}
      {quote(change.before)} → {quote(change.after)}
    </p>
  )
}

function countParts(counts: Record<string, number>) {
  const parts: string[] = []
  if (counts.created) parts.push(`+${counts.created} created`)
  if (counts.updated) parts.push(`${counts.updated} updated`)
  if (counts.published) parts.push(`${counts.published} published`)
  if (counts.deleted) parts.push(`${counts.deleted} deleted`)
  return parts
}

export function ActivityCard({
  card,
  projectId,
  compact = false,
  onUndo,
}: {
  card: ActivityFeedCard
  projectId: string
  compact?: boolean
  onUndo?: (card: ActivityFeedCard) => void
}) {
  const [open, setOpen] = useState(false)
  const isBatch = card.kind === 'batch'
  const parts = countParts(card.counts)

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
        {!isBatch
          ? card.changed.slice(0, 3).map((change) => (
              <ChangeLine
                key={`${change.field}:${change.locale ?? ''}:${change.before}:${change.after}`}
                change={change}
              />
            ))
          : null}
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
            {open ? (
              <ul className="mt-1 flex flex-col gap-1 border-l pl-3">
                {card.children.map((child) => (
                  <li key={child.id} className="text-xs text-muted-foreground">
                    <span className="font-mono text-foreground/80">
                      {child.string_key ?? 'string'}
                    </span>{' '}
                    {child.summary}
                  </li>
                ))}
              </ul>
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
