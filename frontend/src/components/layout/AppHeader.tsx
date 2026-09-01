import { Link } from '@tanstack/react-router'
import { Layers } from 'lucide-react'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { UserMenu } from '@/components/layout/UserMenu'
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
    <header className="sky-chrome relative z-30 shrink-0">
      <div
        className={cn(
          'flex h-14 items-center gap-3',
          contained ? 'container' : 'px-5',
        )}
      >
        {leading ? <div className="flex items-center">{leading}</div> : null}
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5 text-foreground"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/15">
            <Layers className="size-4 text-primary" />
          </span>
          <span className="text-sm font-semibold tracking-tight">TMS</span>
        </Link>
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
