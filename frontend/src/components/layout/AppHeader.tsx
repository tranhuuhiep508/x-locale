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
    <header className="sky-chrome sticky top-0 z-30 shrink-0 border-b border-border/40">
      <div
        className={cn(
          'flex h-14 items-center gap-3',
          contained ? 'container' : 'px-5',
        )}
      >
        {leading ? <div className="flex items-center">{leading}</div> : null}
        <Link
          to="/"
          className="group flex shrink-0 items-center gap-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20 transition-colors group-hover:bg-primary/20">
            <Layers className="size-4 text-primary" />
          </span>
          <span className="text-base font-semibold tracking-tight">x-locale</span>
        </Link>
        {title ? (
          <div className="flex min-w-0 items-center gap-2 border-l border-border/80 pl-3">
            <span
              className="min-w-0 max-w-56 truncate text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              title={title}
            >
              {title}
            </span>
          </div>
        ) : null}
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
