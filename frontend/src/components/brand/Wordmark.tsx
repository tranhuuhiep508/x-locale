import { Link } from '@tanstack/react-router'
import { BrandMark } from '@/components/brand/BrandMark'
import { cn } from '@/lib/utils'

export function Wordmark({
  to = '/',
  className,
  markClassName,
  wordClassName,
}: {
  to?: '/'
  className?: string
  markClassName?: string
  wordClassName?: string
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex shrink-0 items-center gap-2.5 text-foreground',
        className,
      )}
    >
      <BrandMark className={markClassName} />
      <span
        className={cn(
          'font-heading text-lg leading-none font-medium tracking-tight',
          wordClassName,
        )}
      >
        x-locale
      </span>
    </Link>
  )
}
