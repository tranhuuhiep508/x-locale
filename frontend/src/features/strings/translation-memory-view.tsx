import { useState, type ReactNode } from 'react'
import { ChevronDown, History, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
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
  const label = match.exact ? 'Exact match' : `${pct}% similar`
  const fill = 10 + ((Math.max(80, Math.min(100, pct)) - 80) / 20) * 90
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 text-[11px] font-semibold tabular-nums',
        match.exact ? 'text-azure-800' : pct >= 90 ? 'text-azure-700' : 'text-haze-600'
      )}
    >
      <span
        role="meter"
        aria-label="Published source similarity"
        aria-valuemin={80}
        aria-valuemax={100}
        aria-valuenow={Math.max(80, pct)}
        aria-valuetext={
          match.exact
            ? 'Exact source match, previously published'
            : `${pct}% similar source, previously published`
        }
        className="h-1.5 w-10 overflow-hidden rounded-full bg-haze-200"
      >
        <span
          className={cn(
            'block h-full rounded-full',
            match.exact ? 'bg-azure-700' : pct >= 90 ? 'bg-azure-500' : 'bg-azure-300'
          )}
          style={{ width: `${fill}%` }}
        />
      </span>
      {label}
    </span>
  )
}

export function MemoryMatch({
  locale,
  match,
  disabled,
  used,
  hideUse,
  actions,
  onUse,
}: {
  locale: string
  match: TranslationMemoryMatch
  disabled?: boolean
  used?: boolean
  hideUse?: boolean
  actions?: ReactNode
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
        </div>
        {!match.exact ? (
          <p className="text-xs whitespace-pre-wrap wrap-anywhere text-muted-foreground">
            Source: {match.matched_source_text}
          </p>
        ) : null}
        <p className="text-sm whitespace-pre-wrap wrap-anywhere">{match.translation}</p>
        <p className="font-mono text-xs text-muted-foreground break-all">
          <span translate="no">{match.key}</span> · {match.module_slug ?? 'Unassigned'}
        </p>
      </div>
      {actions}
      {hideUse ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || used}
          aria-label={`Use ${locale} match from ${match.key}`}
          onClick={() => onUse(match)}
        >
          {used ? 'Used' : 'Use'}
        </Button>
      )}
    </div>
  )
}

function MemoryLocale({
  locale,
  matches,
  disabled,
  selected,
  onUse,
}: {
  locale: string
  matches: TranslationMemoryMatch[]
  disabled?: boolean
  selected?: string
  onUse: (match: TranslationMemoryMatch) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="w-7 shrink-0 pt-1 font-mono text-xs uppercase text-muted-foreground">
        {locale}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {matches.length ? (
          (expanded ? matches.slice(0, 3) : matches.slice(0, 1)).map((match, index) => (
            <MemoryMatch
              key={match.string_id}
              locale={locale}
              match={match}
              disabled={disabled}
              used={selected === match.string_id}
              onUse={onUse}
              actions={index === 0 && matches.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`${expanded ? 'Collapse' : 'More'} matches for ${locale}`}
                  aria-expanded={expanded}
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? 'Less' : `+${Math.min(matches.length, 3) - 1}`}
                  <ChevronDown className={cn('size-3', expanded && 'rotate-180')} />
                </Button>
              ) : null}
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
  error,
  disabled,
  selected,
  onUse,
  onUseExact,
  onUndo,
}: {
  locales: string[]
  matches: Record<string, TranslationMemoryMatch[]>
  loading: boolean
  error?: string
  disabled?: boolean
  selected: Record<string, string>
  onUse: (locale: string, match: TranslationMemoryMatch) => void
  onUseExact: () => void
  onUndo?: () => void
}) {
  const count = locales.filter((locale) => matches[locale]?.length).length
  const exact = locales.filter(
    (locale) => matches[locale]?.some((match) => match.exact) && !(locale in selected)
  ).length
  return (
    <section aria-label="Previously published" className="rounded-xl border bg-muted/20 px-3">
      {loading || (!error && count > 0) ? <div className="flex items-center justify-between gap-2 py-2">
        <MemoryCount
          icon={History}
          label={
            loading
              ? 'Finding published translations…'
              : `Previously published: ${count} of ${locales.length} locales have a match`
          }
        >
          {loading ? <Spinner aria-hidden="true" /> : `${count}/${locales.length}`}
        </MemoryCount>
        <div className="flex gap-1">
          {exact > 0 && !loading && !error ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={onUseExact}
            >
              Use {exact} exact
            </Button>
          ) : null}
          {onUndo ? (
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onUndo}>
              Undo
            </Button>
          ) : null}
        </div>
      </div> : null}
      {loading ? (
        <div
          role="status"
          aria-label="Finding published translations…"
          className="flex flex-col gap-3 pb-3"
        >
          {locales.map((locale) => (
            <Skeleton key={locale} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <p role="status" className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <History className="size-3.5" aria-hidden="true" />
          Could not load published translations.
        </p>
      ) : count === 0 ? (
        <p role="status" className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
          <History className="size-3.5 shrink-0" aria-hidden="true" />
          No previously published match for this source text. Generate with AI fills the empty locales.
        </p>
      ) : (
        <div className="divide-y">
          {locales.map((locale) => (
            <MemoryLocale
              key={locale}
              locale={locale}
              matches={matches[locale] ?? []}
              disabled={disabled}
              selected={selected[locale]}
              onUse={(match) => onUse(locale, match)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
