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
        'flex size-8 shrink-0 items-center justify-center rounded-md bg-lagoon-50 text-lagoon-800 ring-1 ring-lagoon-200 dark:bg-lagoon-950 dark:text-lagoon-200 dark:ring-lagoon-800',
        className,
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
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <TitleTag className="font-heading text-2xl font-medium tracking-tight text-foreground">
          {title}
        </TitleTag>
        {description ? (
          <div className="mt-1 text-sm text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
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
        contained ? 'container py-8' : 'flex flex-col gap-6 px-5 py-6',
        className,
      )}
    >
      {children}
    </div>
  )
}
