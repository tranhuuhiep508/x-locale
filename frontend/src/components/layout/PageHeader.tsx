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
        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15',
        className
      )}
    >
      {children}
    </span>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  titleAs: TitleTag = 'h1',
  className,
}: {
  eyebrow?: string
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  titleAs?: 'h1' | 'h2'
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <TitleTag
          className={cn(
            'font-heading font-semibold tracking-tight text-foreground',
            TitleTag === 'h1' ? 'text-2xl leading-tight sm:text-3xl' : 'text-xl'
          )}
        >
          {title}
        </TitleTag>
        {description ? (
          <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>
      ) : null}
    </div>
  )
}

export function PageBody({
  children,
  contained = false,
  className,
}: {
  children: React.ReactNode
  contained?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        contained ? 'container py-8 sm:py-10' : 'flex flex-col gap-7 px-4 py-6 sm:px-6 sm:py-8',
        className
      )}
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
