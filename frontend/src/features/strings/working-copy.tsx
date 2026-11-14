import { useState } from 'react'
import { GitCompareArrows } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import type { StringEntry } from '@/lib/api/types'
import { cn } from '@/lib/utils'

export type ReleaseState = 'draft' | 'live' | 'edited' | 'removing' | 'deleted'

export function releaseState(entry: StringEntry): ReleaseState {
  if (entry.deleted_at) return 'deleted'
  if (entry.pending_delete) return 'removing'
  if (entry.has_unpublished_changes) return 'edited'
  if (entry.status === 'public') return 'live'
  return 'draft'
}

export function isReleased(entry: StringEntry): boolean {
  return entry.published_key != null || Boolean(entry.published_at)
}

export function canDiscardWorkingCopy(entry: StringEntry): boolean {
  return (
    !entry.deleted_at &&
    entry.has_unpublished_changes &&
    isReleased(entry)
  )
}

export function liveTranslation(entry: StringEntry, locale: string): string | null {
  const translation = entry.translations.find((item) => item.locale === locale)
  return translation?.published_value ?? null
}

export function differs(working: string, live: string | null | undefined): boolean {
  return (working ?? '') !== (live ?? '')
}

export function fieldChanged(
  working: string,
  live: string | null | undefined,
  released: boolean,
): boolean {
  return released && differs(working, live)
}

const STATE_LABEL: Record<ReleaseState, string> = {
  draft: 'Draft',
  live: 'Live',
  edited: 'Editing',
  removing: 'Removing',
  deleted: 'Deleted',
}

const STATE_VARIANT: Record<ReleaseState, 'outline' | 'default' | 'secondary' | 'destructive'> = {
  draft: 'outline',
  live: 'default',
  edited: 'default',
  removing: 'destructive',
  deleted: 'destructive',
}

const STATE_BADGE_STYLE: Record<ReleaseState, string> = {
  draft: '',
  live: '',
  edited:
    'eyebrow border-public-foreground/25 bg-public text-public-foreground text-3xs px-1.5 py-0',
  removing:
    'eyebrow border-transparent bg-destructive text-destructive-foreground text-3xs px-1.5 py-0',
  deleted:
    'eyebrow border-border bg-muted text-muted-foreground text-3xs px-1.5 py-0',
}

export function ReleaseBadge({
  state,
  className,
}: {
  state: ReleaseState
  className?: string
}) {
  if (state === 'draft' || state === 'live') return null
  return (
    <Badge
      variant={STATE_VARIANT[state]}
      className={cn('inline-flex items-center rounded-md', STATE_BADGE_STYLE[state], className)}
    >
      {STATE_LABEL[state]}
    </Badge>
  )
}

export function releaseRowClassName(state: ReleaseState): string | undefined {
  if (state === 'edited') {
    return 'string-row-edited [&>td:first-child]:shadow-[inset_3px_0_0_0_var(--color-public-foreground)]'
  }
  if (state === 'removing') {
    return 'string-row-removing [&>td:first-child]:shadow-[inset_3px_0_0_0_var(--color-destructive)]'
  }
  if (state === 'deleted') {
    return 'string-row-deleted text-muted-foreground'
  }
  return undefined
}

function displayText(value: string | null | undefined): string {
  const text = (value ?? '').trim()
  return text || 'empty'
}

export function ChangedValueHint({
  published,
  working,
  mono = false,
  showWorking = true,
}: {
  published: string | null | undefined
  working: string
  mono?: boolean
  showWorking?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={80} closeDelay={120}>
      <HoverCardTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-expanded={open}
          className="h-5 w-5 shrink-0 rounded border border-public-foreground/25 bg-public/90 text-public-foreground hover:border-public-foreground/45 hover:bg-public hover:text-public-foreground"
          aria-label={showWorking ? 'Compare published and working values' : 'View published value'}
          onClick={(event) => {
            event.stopPropagation()
            setOpen((current) => !current)
          }}
        >
          <GitCompareArrows className="size-3" />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="flex w-80 flex-col gap-2.5 p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="eyebrow text-3xs">
          {showWorking ? 'Published vs. working copy' : 'Published snapshot'}
        </p>
        <div className="flex flex-col gap-1 rounded-md border border-border/75 bg-muted/45 px-2.5 py-2">
          <p className="eyebrow text-3xs">
            Published
          </p>
          <p className={cn('text-xs leading-relaxed text-muted-foreground wrap-break-word', mono && 'font-mono text-2xs break-all')}>
            {displayText(published)}
          </p>
        </div>
        {showWorking ? (
          <div className="flex flex-col gap-1 rounded-md border border-public-foreground/25 bg-public/60 px-2.5 py-2">
            <p className="eyebrow text-3xs text-public-foreground">
              Working
            </p>
            <p className={cn('text-xs leading-relaxed text-foreground wrap-break-word', mono && 'font-mono text-2xs break-all')}>
              {displayText(working)}
            </p>
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  )
}

export function PublishedChangeHint({
  published,
  working,
  released,
  mono = false,
}: {
  published: string | null | undefined
  working: string
  released: boolean
  mono?: boolean
}) {
  if (!fieldChanged(working, published, released)) return null
  return (
    <ChangedValueHint
      published={published}
      working={working}
      mono={mono}
      showWorking={false}
    />
  )
}

export function WorkingCopyCell({
  working,
  published,
  released,
  emptyLabel = 'Missing',
  mono = false,
  lineClamp = 'line-clamp-2',
}: {
  working: string
  published: string | null | undefined
  released: boolean
  emptyLabel?: string
  mono?: boolean
  lineClamp?: string
}) {
  const workingText = working.trim()
  const changed = fieldChanged(working, published, released)

  return (
    <div className="flex items-start justify-between gap-1.5">
      {workingText ? (
        <p
          className={cn(
            'min-w-0 flex-1 text-sm leading-snug wrap-break-word group-data-[density=compact]/table:line-clamp-1 group-data-[density=compact]/table:text-xs',
            lineClamp,
            mono && 'font-mono text-xs break-all',
          )}
        >
          {working}
        </p>
      ) : (
        <span className="text-xs italic text-missing-foreground">{emptyLabel}</span>
      )}
      {changed ? <ChangedValueHint published={published} working={working} mono={mono} /> : null}
    </div>
  )
}

export function releaseCopy(state: ReleaseState): { title: string; body: string } {
  switch (state) {
    case 'deleted':
      return {
        title: 'Removed from live and staging',
        body: 'This string is hidden. Restore it to bring the working copy back; publish again if you want it live.',
      }
    case 'removing':
      return {
        title: 'Queued to leave live',
        body: 'Staging no longer has this key. Live still serves the last published text until you publish the removal.',
      }
    case 'edited':
      return {
        title: 'Working copy is ahead of live',
        body: 'Edits stay here until you publish. Publish to live replaces the current production text.',
      }
    case 'live':
      return {
        title: 'This string is live',
        body: 'You are editing the working copy. Live stays as-is until you publish again.',
      }
    default:
      return {
        title: 'Not on live yet',
        body: 'Save keeps this as a working draft. Publish to live when you want production to pick it up.',
      }
  }
}
