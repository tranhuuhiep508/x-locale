import type { ReactNode } from 'react'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  variant?: 'plain' | 'dashed'
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = 'plain',
  className,
}: EmptyStateProps) {
  return (
    <Empty
      className={cn(
        variant === 'dashed' ? 'border border-dashed border-border/80 bg-card/50 py-10' : 'border-none py-12',
        className
      )}
    >
      <EmptyHeader>
        {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}
