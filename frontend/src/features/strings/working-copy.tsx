import { useState } from 'react'
import { GitCompareArrows } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import type { StringEntry } from '@/lib/api/types'
import { cn } from '@/lib/utils'

export type ReleaseState = 'draft' | 'live' | 'edited' | 'removing' | 'deleted'

export function isReleased(entry: StringEntry): boolean {
  return entry.published_key != null || Boolean(entry.published_at)
}

/** Live in the public catalog. Unpublish keeps published_* but the row is no longer live. */
export function isLivePublic(entry: StringEntry): boolean {
  return entry.status === 'public' && !entry.deleted_at
}

export function releaseState(entry: StringEntry): ReleaseState {
  if (entry.deleted_at) return 'deleted'
  if (entry.pending_delete) return 'removing'
  if (isLivePublic(entry) && entry.has_unpublished_changes) return 'edited'
  if (isLivePublic(entry)) return 'live'
  return 'draft'
}

export function canDiscardWorkingCopy(entry: StringEntry): boolean {
  return (
    !entry.deleted_at &&
    entry.has_unpublished_changes &&
    isReleased(entry) &&
    (isLivePublic(entry) || entry.pending_delete)
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

export function ReleaseBadge({
  state,
  className,
}: {
  state: ReleaseState
  className?: string
}) {
  if (state === 'draft' || state === 'live') return null
  return (
    <Badge variant={STATE_VARIANT[state]} className={className}>
      {STATE_LABEL[state]}
    </Badge>
  )
}

export function releaseRowClassName(state: ReleaseState): string | undefined {
  if (state === 'edited') {
    return 'bg-public/80 hover:bg-public [&>td:first-child]:shadow-[inset_3px_0_0_0_var(--color-public-foreground)]'
  }
  if (state === 'removing') {
    return 'bg-destructive/5 hover:bg-destructive/10 [&>td:first-child]:shadow-[inset_3px_0_0_0_var(--color-destructive)]'
  }
  if (state === 'deleted') {
    return 'bg-muted/40 text-muted-foreground'
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
          className="shrink-0 text-public-foreground hover:text-public-foreground"
          aria-label={showWorking ? 'Compare published and working values' : 'View published value'}
          onClick={(event) => {
            event.stopPropagation()
            setOpen((current) => !current)
          }}
        >
          <GitCompareArrows />
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="flex w-72 flex-col gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-0.5">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Published
          </p>
          <p className={cn('text-sm wrap-break-word', mono && 'font-mono text-xs break-all')}>
            {displayText(published)}
          </p>
        </div>
        {showWorking ? (
          <div className="flex flex-col gap-0.5">
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Working
            </p>
            <p className={cn('text-sm wrap-break-word', mono && 'font-mono text-xs break-all')}>
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
    <div className="flex items-start gap-1">
      {workingText ? (
        <p
          className={cn(
            'min-w-0 text-sm leading-snug wrap-break-word',
            lineClamp,
            mono && 'font-mono text-xs break-all',
          )}
        >
          {working}
        </p>
      ) : (
        <span className="text-missing-foreground italic text-sm">{emptyLabel}</span>
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
