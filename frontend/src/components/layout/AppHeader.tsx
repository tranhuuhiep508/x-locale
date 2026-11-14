import { Link } from '@tanstack/react-router'
import { HelpMenu } from '@/components/layout/HelpMenu'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { UserMenu } from '@/components/layout/UserMenu'
import { cn } from '@/lib/utils'

export function MeridianMark({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={cn('transition-transform duration-300 ease-drift group-hover:scale-105', className)}
    >
      <rect
        x="2.5"
        y="3.5"
        width="6"
        height="13"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.75"
        className="transition-transform duration-300 ease-drift group-hover:-translate-y-0.5"
      />
      <rect
        x="11.5"
        y="3.5"
        width="6"
        height="13"
        rx="1.5"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.75"
        className="transition-transform duration-300 ease-drift group-hover:translate-y-0.5"
      />
      <path d="M8.5 10H11.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

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
    <header className="sky-chrome sticky top-0 z-30 shrink-0 border-b border-border/60">
      <div
        className={cn(
          'flex h-(--app-header-height) items-center gap-2.5 sm:gap-3',
          contained ? 'container' : 'px-3.5 sm:px-5',
        )}
      >
        {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
        <Link
          to="/"
          aria-label="x-locale"
          className="group flex shrink-0 items-center gap-2.5 rounded-lg text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-7 items-center justify-center rounded-md border border-accent-foreground/25 bg-accent text-accent-foreground transition-colors group-hover:border-accent-foreground/40 group-hover:bg-accent">
            <MeridianMark className="size-4" />
          </span>
          <span className="hidden font-heading text-base font-semibold tracking-tight sm:inline">
            x-locale
          </span>
        </Link>
        {title ? (
          <div className="hidden min-w-0 items-center gap-2.5 pl-1 sm:flex">
            <span aria-hidden="true" className="font-mono text-xs text-border select-none">
              /
            </span>
            <span
              className="min-w-0 max-w-60 truncate text-sm font-medium text-foreground/85"
              title={title}
            >
              {title}
            </span>
          </div>
        ) : null}
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
          <HelpMenu />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
