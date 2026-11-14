import { cn } from '@/lib/utils'

export function MarkWell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md border border-border/80 bg-muted/50 text-muted-foreground transition-all duration-300 ease-drift group-hover:border-primary/40 group-hover:bg-primary/10 group-hover:text-primary group-hover:shadow-2xs',
        className
      )}
    >
      {children}
    </span>
  )
}

export function PageHeader({
  leading,
  title,
  badge,
  actions,
  titleAs: TitleTag = 'h1',
  className,
}: {
  leading?: React.ReactNode
  title: React.ReactNode
  badge?: React.ReactNode
  actions?: React.ReactNode
  titleAs?: 'h1' | 'h2'
  className?: string
}) {
  return (
    <div
      className={cn(
        'animate-stage-in flex flex-wrap items-center justify-between gap-x-4 gap-y-2',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <TitleTag
          className={cn(
            'font-heading font-semibold tracking-tight text-foreground',
            TitleTag === 'h1' ? 'text-lg leading-tight sm:text-xl' : 'text-base leading-tight'
          )}
        >
          {title}
        </TitleTag>
        {badge}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">{actions}</div>
      ) : null}
    </div>
  )
}

export function PageBody({
  children,
  contained = false,
  className,
  ...props
}: React.ComponentProps<'div'> & {
  contained?: boolean
}) {
  return (
    <div
      className={cn(
        contained
          ? 'container flex flex-col gap-4 py-4 sm:gap-5 sm:py-5'
          : 'flex flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-5',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function PageStickyHeader({
  children,
  maxWidth = '6xl',
  className,
  innerClassName,
}: {
  children: React.ReactNode
  maxWidth?: '5xl' | '6xl' | 'full'
  className?: string
  innerClassName?: string
}) {
  return (
    <header
      className={cn(
        'sky-chrome sticky top-0 z-20 shrink-0',
        className
      )}
    >
      <div
        className={cn(
          'mx-auto w-full px-4 py-3 sm:px-6 sm:py-3.5',
          maxWidth === '6xl' && 'max-w-6xl',
          maxWidth === '5xl' && 'max-w-5xl',
          innerClassName
        )}
      >
        {children}
      </div>
    </header>
  )
}
