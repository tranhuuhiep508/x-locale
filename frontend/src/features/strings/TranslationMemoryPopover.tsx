import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { QaCountBadges } from '@/features/strings/qa-issue-view'
import { issueCounts, presentQaIssues } from '@/features/strings/qa-issues'
import type { TranslationMemoryMatch } from '@/lib/api/types'

export function TranslationMemoryPopover({
  locale,
  matches = [],
  loading = false,
  error,
  stale = false,
  disabled = false,
  onRetry,
  onUse,
}: {
  locale: string
  matches?: TranslationMemoryMatch[]
  loading?: boolean
  error?: string | null
  stale?: boolean
  disabled?: boolean
  onRetry?: () => void
  onUse: (match: TranslationMemoryMatch) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Previously published for ${locale}: ${matches.length} matches`}
        >
          {loading ? <Spinner data-icon="inline-start" /> : null}
          Previously published ({matches.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        collisionPadding={12}
        className="w-[min(26rem,calc(100vw-2rem))] max-h-[min(24rem,var(--radix-popover-content-available-height))] overflow-y-auto"
        aria-label={`Previously published translations for ${locale}`}
      >
        <p className="font-medium">Previously published · {locale}</p>
        {loading ? (
          <p role="status">Finding published translations…</p>
        ) : error ? (
          <p role="status" className="text-destructive">
            {error}
          </p>
        ) : stale ? (
          <p className="text-muted-foreground">
            Source text changed. Check published translations again.
          </p>
        ) : matches.length === 0 ? (
          <p className="text-muted-foreground">No published matches.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {matches.map((match) => {
              const issues = presentQaIssues(match.issues)
              const counts = issueCounts(issues)
              return (
                <li key={match.string_id} className="flex flex-col gap-2 rounded-md border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {match.exact
                        ? 'Exact match'
                        : `${Math.round(match.similarity * 100)}% similar`}
                    </Badge>
                    <QaCountBadges {...counts} showClean={false} />
                  </div>
                  {!match.exact ? (
                    <p className="whitespace-pre-wrap wrap-anywhere text-muted-foreground">
                      Source: {match.matched_source_text}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap wrap-anywhere">{match.translation}</p>
                  <p className="text-xs text-muted-foreground break-all">
                    <code translate="no">{match.key}</code> · {match.module_slug ?? 'Unassigned'}
                  </p>
                  {issues.length > 0 ? (
                    <ul className="flex flex-col gap-1 text-xs">
                      {issues.map((issue, index) => (
                        <li key={index}>
                          {issue.severity === 'error' ? 'Error' : 'Warning'}: {issue.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      onUse(match)
                      setOpen(false)
                    }}
                    aria-label={`Use published translation from ${match.key}`}
                  >
                    Use
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {onRetry && (error || stale) && !loading ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Check again
          </Button>
        ) : null}
        {matches.some((match) => match.issues.length > 0) ? (
          <p className="text-xs text-muted-foreground">
            QA is advisory. You can still use a suggestion.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
