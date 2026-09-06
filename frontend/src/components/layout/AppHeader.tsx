import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { UserMenu } from '@/components/layout/UserMenu'
import { Wordmark } from '@/components/brand/Wordmark'
import { cn } from '@/lib/utils'

export function AppHeader({
  leading,
  title,
  contained = false,
}: {
  leading?: React.ReactNode
  title?: string
  contained?: boolean
}) {
  return (
    <header className="relative z-30 shrink-0 border-b border-border bg-card">
      <div
        className={cn(
          'flex h-14 items-center gap-3',
          contained ? 'container' : 'px-5',
        )}
      >
        {leading ? <div className="flex items-center">{leading}</div> : null}
        <Wordmark />
        {title ? (
          <span
            className="min-w-0 max-w-48 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
            title={title}
          >
            {title}
          </span>
        ) : null}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}

export function GuestHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5 lg:hidden">
      <Wordmark className="text-foreground" />
      <ThemeToggle />
    </header>
  )
}
