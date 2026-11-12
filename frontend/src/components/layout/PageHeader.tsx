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
        'flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary transition-all duration-300 ease-drift group-hover:scale-105 group-hover:border-primary/40 group-hover:bg-primary/15 group-hover:shadow-2xs',
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
        <span
          aria-hidden="true"
          className="h-4 w-0.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]"
        />
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

export function PageSection({
  title,
  description,
  children,
}: {
  title: string
  description: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="grid min-w-0 gap-4 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
      <div className="flex flex-col gap-2">
        <h2 className="font-heading text-sm font-semibold">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
