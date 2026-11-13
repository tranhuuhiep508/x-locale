import { useRef, useState, type ReactNode } from 'react'
import { CheckCheck, ChevronDown, ChevronUp, History, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { QaIssueBadge } from './qa-issue-view'
import type { TranslationMemoryMatch } from '@/lib/api/types'
import { cn } from '@/lib/utils'

export function MemoryCount({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const trigger = triggerRef.current
        // Dialog open moves focus here programmatically; that is not a hover or keyboard focus.
        if (next && trigger && document.activeElement === trigger && !trigger.matches(':focus-visible')) return
        setOpen(next)
      }}
    >
      <TooltipTrigger asChild>
        <span
          ref={triggerRef}
          tabIndex={0}
          data-memory-count=""
          aria-label={label}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function MatchBar({ match }: { match: TranslationMemoryMatch }) {
  const pct = match.exact ? 100 : Math.min(99, Math.floor(match.similarity * 100))
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center text-[11px] font-semibold tabular-nums',
        match.exact
          ? 'text-azure-800 dark:text-azure-200'
          : pct >= 90
            ? 'text-azure-700 dark:text-azure-300'
            : 'text-haze-600 dark:text-haze-400'
      )}
    >
      {match.exact ? 'Exact match' : `${pct}% similar`}
    </span>
  )
}

function UpdatingMatches({ stale, children }: { stale?: boolean; children: ReactNode }) {
  if (!stale) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent>Updating matches…</TooltipContent>
    </Tooltip>
  )
}

export function MemoryMatch({
  locale,
  match,
  disabled,
  stale,
  used,
  hideUse,
  accessory,
  onUse,
}: {
  locale: string
  match: TranslationMemoryMatch
  disabled?: boolean
  stale?: boolean
  used?: boolean
  hideUse?: boolean
  accessory?: ReactNode
  onUse: (match: TranslationMemoryMatch) => void
}) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <MatchBar match={match} />
          <QaIssueBadge
            label={`${locale} match from ${match.key}`}
            issues={match.issues}
            footer="Advisory only. You can still use this match."
            showClean={false}
          />
          {accessory}
        </div>
        {!match.exact ? (
          <p className="text-xs whitespace-pre-wrap wrap-anywhere text-muted-foreground">
            Source: {match.matched_source_text}
          </p>
        ) : null}
        <p className="text-sm whitespace-pre-wrap wrap-anywhere">{match.translation}</p>
        <p className="flex min-w-0 text-xs text-muted-foreground">
          <span className="min-w-0 truncate font-mono" title={match.key} translate="no">{match.key}</span>
          <span className="shrink-0">{' · '}{match.module_slug ?? 'Unassigned'}</span>
        </p>
      </div>
      {hideUse ? null : (
        <UpdatingMatches stale={stale}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || stale || used}
            aria-label={`Use ${locale} match from ${match.key}`}
            onClick={() => onUse(match)}
          >
            {used ? 'Used' : 'Use'}
          </Button>
        </UpdatingMatches>
      )}
    </div>
  )
}

function MemoryLocale({
  locale,
  matches,
  disabled,
  stale,
  selected,
  onUse,
}: {
  locale: string
  matches: TranslationMemoryMatch[]
  disabled?: boolean
  stale?: boolean
  selected?: string
  onUse: (match: TranslationMemoryMatch) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // The API returns at most three matches per locale.
  const shown = expanded ? matches : matches.slice(0, 1)
  const extra = matches.length - 1
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="w-7 shrink-0 pt-1 font-mono text-xs uppercase text-muted-foreground">
        {locale}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {shown.length ? (
          shown.map((match, index) => (
            <MemoryMatch
              key={match.string_id}
              locale={locale}
              match={match}
              disabled={disabled}
              stale={stale}
              used={selected === match.string_id}
              accessory={index === 0 && extra > 0 ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
                  aria-label={`${expanded ? 'Collapse' : 'More'} matches for ${locale}`}
                  aria-expanded={expanded}
                  onClick={() => setExpanded((open) => !open)}
                >
                  {expanded ? 'Less' : `+${extra}`}
                  {expanded ? <ChevronUp className="size-3" aria-hidden="true" /> : <ChevronDown className="size-3" aria-hidden="true" />}
                </button>
              ) : null}
              onUse={onUse}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No match · AI will translate</p>
        )}
      </div>
    </div>
  )
}

export function TranslationMemoryPanel({
  locales,
  matches,
  loading,
  stale,
  error,
  disabled,
  selected,
  onUse,
  onUseExact,
  onUndo,
  onRetry,
}: {
  locales: string[]
  matches: Record<string, TranslationMemoryMatch[]>
  loading: boolean
  stale?: boolean
  error?: string
  disabled?: boolean
  selected: Record<string, string>
  onUse: (locale: string, match: TranslationMemoryMatch) => void
  onUseExact: () => void
  onUndo?: () => void
  onRetry: () => void
}) {
  const count = locales.filter((locale) => matches[locale]?.length).length
  const exact = locales.filter(
    (locale) => matches[locale]?.some((match) => match.exact) && !(locale in selected)
  ).length
  const empty = !loading && !error && count === 0
  const compact = loading || empty || Boolean(error)
  return (
    <section
      aria-label="Previously published"
      className={cn(
        'rounded-xl px-3',
        compact ? 'border border-border/60 bg-muted/15 py-2' : 'border bg-muted/20',
      )}
    >
      <TooltipProvider delayDuration={200}>
      {!compact ? (
        <div className="flex min-h-10 items-center justify-between gap-2 py-2">
          <MemoryCount
            icon={History}
            label={`Previously published: ${count} of ${locales.length} locales have a match`}
          >
            {`${count}/${locales.length}`}
          </MemoryCount>
          <div className="flex gap-1">
            {exact > 0 ? (
              <UpdatingMatches stale={stale}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || stale}
                  onClick={onUseExact}
                >
                  <CheckCheck data-icon="inline-start" />
                  Use {exact} exact
                </Button>
              </UpdatingMatches>
            ) : null}
            {onUndo ? (
              <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onUndo}>
                Undo
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {loading ? (
        <div
          role="status"
          aria-label="Finding published translations…"
          className="flex min-h-6 items-center justify-between gap-2 text-xs text-muted-foreground"
        >
          <MemoryCount icon={History} label="Finding published translations…">
            <Spinner aria-hidden="true" className="size-3.5" />
          </MemoryCount>
          <Skeleton className="h-4 w-16 rounded" />
        </div>
      ) : error ? (
        <div className="flex min-h-6 items-center justify-between gap-2">
          <p role="status" className="text-xs text-muted-foreground">
            Could not load published translations.
          </p>
          <Button type="button" variant="outline" size="sm" disabled={disabled || stale} onClick={onRetry}>
            Check again
          </Button>
        </div>
      ) : empty ? (
        <p className="flex min-h-6 items-center text-xs text-muted-foreground">
          No previously published match for this source text. Generate with AI fills the empty locales.
        </p>
      ) : (
        <div className={cn('divide-y', stale && 'opacity-60')}>
          {locales.map((locale) => (
            <MemoryLocale
              key={locale}
              locale={locale}
              matches={matches[locale] ?? []}
              disabled={disabled}
              stale={stale}
              selected={selected[locale]}
              onUse={(match) => onUse(locale, match)}
            />
          ))}
        </div>
      )}
      </TooltipProvider>
    </section>
  )
}
