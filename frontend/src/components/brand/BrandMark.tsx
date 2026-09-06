import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-7 shrink-0', className)}
      aria-hidden="true"
    >
      <path
        d="M8 8 L24 24"
        fill="none"
        stroke="var(--color-lagoon-500)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <path
        d="M24 8 L8 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  )
}
